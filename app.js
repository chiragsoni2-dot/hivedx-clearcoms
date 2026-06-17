/* =========================================================
   HIVEDX Event Clearcoms — frontend logic
   No build step. Plain browser JavaScript.
   Talks to /api/token for LiveKit auth tokens.
   ========================================================= */

// ---------- Config ----------
const TOKEN_ENDPOINT = '/api/token'; // Vercel serverless function

// ---------- App state ----------
const state = {
  myName: '',
  myIdentity: '', // unique id for this user in the room
  eventCode: '',
  eventDetails: null, // { client, event, venue, date }
  room: null, // LiveKit Room object
  currentChannelRoom: '', // actual LiveKit room name (event code or private channel)
  currentChannelLabel: 'Main Channel',
  isMainChannel: true,
  pendingInvite: null, // { from, channelName, roomName }
  participants: new Map(), // identity -> { name, isSpeaking, isMuted }
};

// ---------- Screen navigation ----------
function goTo(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

// ---------- Toast / notifications ----------
function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 3000);
}

// ---------- Event code generation ----------
function generateEventCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing chars (I,O,1,0)
  let code = 'HIVE-';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ---------- Event creation (Screen 3) ----------
function createEvent() {
  const client = document.getElementById('in-client').value.trim();
  const event = document.getElementById('in-event').value.trim();
  const venue = document.getElementById('in-venue').value.trim();
  const date = document.getElementById('in-date').value.trim();
  const myName = document.getElementById('in-name-create').value.trim();

  if (!client || !event || !venue || !date || !myName) {
    return toast('Please fill in every field', true);
  }

  const code = generateEventCode();
  const details = { client, event, venue, date };

  // Save locally so the creator can see it again
  localStorage.setItem('hivedx-event-' + code, JSON.stringify(details));
  localStorage.setItem('hivedx-last-name', myName);

  state.myName = myName;
  state.eventCode = code;
  state.eventDetails = details;

  document.getElementById('generated-code').textContent = code;
  goTo('screen-created');
}

function copyCode() {
  const code = document.getElementById('generated-code').textContent;
  navigator.clipboard.writeText(code).then(
    () => toast('Code copied!'),
    () => toast('Could not copy — please copy manually', true),
  );
}

function enterEventAsCreator() {
  enterLobby(state.eventCode, state.myName, state.eventDetails);
}

// ---------- Event joining (Screen 4) ----------
function joinEvent() {
  const code = document.getElementById('in-code').value.trim().toUpperCase();
  const myName = document.getElementById('in-name-join').value.trim();
  if (!code || !myName) return toast('Please enter both fields', true);

  // Try to load event details if this device created it
  const stored = localStorage.getItem('hivedx-event-' + code);
  const details = stored ? JSON.parse(stored) : null;

  state.myName = myName;
  state.eventCode = code;
  state.eventDetails = details;
  localStorage.setItem('hivedx-last-name', myName);

  enterLobby(code, myName, details);
}

// ---------- Lobby (Screen 5) ----------
async function enterLobby(eventCode, displayName, details) {
  document.getElementById('loading-text').textContent = 'Connecting to event...';
  goTo('screen-loading');

  try {
    state.myIdentity = displayName + '-' + Math.random().toString(36).slice(2, 8);
    state.currentChannelRoom = eventCode; // main channel = event code
    state.currentChannelLabel = 'Main Channel';
    state.isMainChannel = true;

    await connectToRoom(eventCode);

    // Render event info
    if (details) {
      document.getElementById('lobby-event-name').textContent = details.event;
      document.getElementById('lobby-event-meta').textContent =
        `${details.client} • ${details.venue} • ${details.date}`;
    } else {
      document.getElementById('lobby-event-name').textContent = 'Event ' + eventCode;
      document.getElementById('lobby-event-meta').textContent = 'You joined as ' + displayName;
    }
    document.getElementById('lobby-event-code').textContent = eventCode;
    document.getElementById('current-channel-pill').textContent = state.currentChannelLabel;

    refreshMembersList();
    goTo('screen-lobby');

    // If we don't have event details, ask the room for them
    if (!state.eventDetails) requestEventDetails();
    // If we do have details, share them with anyone who joins later (handled in onParticipantChange)
  } catch (err) {
    console.error(err);
    toast('Failed to connect: ' + err.message, true);
    goTo('screen-choice');
  }
}

// ---------- LiveKit connection ----------
async function fetchToken(roomName, identity, name) {
  const url = `${TOKEN_ENDPOINT}?room=${encodeURIComponent(roomName)}` +
              `&identity=${encodeURIComponent(identity)}` +
              `&name=${encodeURIComponent(name)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Token server: ' + text);
  }
  return await res.json(); // { token, wsUrl }
}

async function connectToRoom(roomName) {
  // Disconnect any existing room
  if (state.room) {
    try { await state.room.disconnect(); } catch (e) {}
    state.room = null;
  }

  const { token, wsUrl } = await fetchToken(roomName, state.myIdentity, state.myName);

  const room = new LivekitClient.Room({
    adaptiveStream: true,
    dynacast: true,
  });

  // Wire up events
  room.on(LivekitClient.RoomEvent.ParticipantConnected, onParticipantConnected);
  room.on(LivekitClient.RoomEvent.ParticipantDisconnected, onParticipantChange);
  room.on(LivekitClient.RoomEvent.TrackSubscribed, onTrackSubscribed);
  room.on(LivekitClient.RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
  room.on(LivekitClient.RoomEvent.TrackMuted, onParticipantChange);
  room.on(LivekitClient.RoomEvent.TrackUnmuted, onParticipantChange);
  room.on(LivekitClient.RoomEvent.ActiveSpeakersChanged, onActiveSpeakersChange);
  room.on(LivekitClient.RoomEvent.DataReceived, onDataReceived);
  room.on(LivekitClient.RoomEvent.Disconnected, onDisconnected);

  await room.connect(wsUrl, token);

  // Don't publish mic yet — wait for "Join the Conversation"
  state.room = room;
}

function onTrackSubscribed(track, publication, participant) {
  if (track.kind === 'audio') {
    const el = track.attach();
    el.id = 'audio-' + participant.identity;
    el.autoplay = true;
    document.body.appendChild(el);
  }
}
function onTrackUnsubscribed(track, publication, participant) {
  const el = document.getElementById('audio-' + participant.identity);
  if (el) el.remove();
  track.detach();
}

function onParticipantChange() { refreshMembersList(); }

function onParticipantConnected(participant) {
  refreshMembersList();
  // If I'm in the main channel and have event details, share them with the newcomer
  if (state.isMainChannel && state.eventDetails && participant?.identity) {
    setTimeout(() => broadcastEventDetails([participant.identity]), 500);
  }
}

function onActiveSpeakersChange(speakers) {
  // Speakers is array of Participant. Highlight talk circle if I'm speaking.
  const myId = state.room?.localParticipant?.identity;
  const iAmSpeaking = speakers.some(p => p.identity === myId);
  refreshMembersList();
  // Ripple effect could go here
}

function onDataReceived(payload, participant) {
  try {
    const text = new TextDecoder().decode(payload);
    const msg = JSON.parse(text);
    if (msg.type === 'private_channel_invite') {
      state.pendingInvite = {
        from: participant?.name || participant?.identity || 'Someone',
        channelName: msg.channelName,
        roomName: msg.roomName,
      };
      showInviteBanner();
    } else if (msg.type === 'event_details' && !state.eventDetails) {
      // Someone in the room is sharing the event metadata — adopt it
      state.eventDetails = msg.details;
      const d = msg.details;
      document.getElementById('lobby-event-name').textContent = d.event;
      document.getElementById('lobby-event-meta').textContent =
        `${d.client} • ${d.venue} • ${d.date}`;
    } else if (msg.type === 'request_event_details' && state.eventDetails && state.isMainChannel) {
      // A newcomer is asking for details — answer if I have them
      broadcastEventDetails([participant.identity]);
    }
  } catch (e) { /* ignore malformed messages */ }
}

async function broadcastEventDetails(toIdentities) {
  if (!state.room || !state.eventDetails) return;
  const msg = JSON.stringify({ type: 'event_details', details: state.eventDetails });
  const data = new TextEncoder().encode(msg);
  try {
    await state.room.localParticipant.publishData(data, {
      reliable: true,
      destinationIdentities: toIdentities,
    });
  } catch (e) { /* ok */ }
}

async function requestEventDetails() {
  if (!state.room || state.eventDetails) return;
  const msg = JSON.stringify({ type: 'request_event_details' });
  const data = new TextEncoder().encode(msg);
  try {
    await state.room.localParticipant.publishData(data, { reliable: true });
  } catch (e) { /* ok */ }
}

function onDisconnected(reason) {
  // Clean up audio elements
  document.querySelectorAll('audio[id^="audio-"]').forEach(el => el.remove());
}

// ---------- Members list rendering ----------
function refreshMembersList() {
  if (!state.room) return;
  const me = state.room.localParticipant;
  const others = Array.from(state.room.remoteParticipants.values());
  const all = [me, ...others];

  const lobbyList = document.getElementById('members-list');
  const talkList = document.getElementById('talk-members-list');
  document.getElementById('member-count').textContent = all.length;
  document.getElementById('talk-member-count').textContent = all.length;

  const html = all.map(p => {
    const isMe = p.identity === me.identity;
    const name = p.name || p.identity;
    const initial = name.charAt(0).toUpperCase();
    const micPub = Array.from(p.trackPublications.values()).find(t => t.kind === 'audio');
    const isPublishingAudio = micPub && !micPub.isMuted;
    const isSubscribed = p.audioTrackPublications && p.audioTrackPublications.size > 0;
    let status, statusClass;
    if (isMe && !isPublishingAudio) { status = 'In lobby'; statusClass = ''; }
    else if (isPublishingAudio) { status = 'Live'; statusClass = 'live'; }
    else { status = 'Muted'; statusClass = 'muted'; }
    return `
      <div class="member-row">
        <div class="member-avatar">${initial}</div>
        <div class="member-name">${name}${isMe ? ' (you)' : ''}</div>
        <div class="member-status ${statusClass}">${status}</div>
      </div>
    `;
  }).join('');

  lobbyList.innerHTML = html;
  talkList.innerHTML = html;
}

// ---------- Join the conversation (Screen 6) ----------
async function joinConversation() {
  if (!state.room) return toast('Not connected', true);
  document.getElementById('loading-text').textContent = 'Opening microphone...';
  goTo('screen-loading');

  try {
    await state.room.localParticipant.setMicrophoneEnabled(true);

    document.getElementById('talk-event-name').textContent =
      document.getElementById('lobby-event-name').textContent;
    document.getElementById('talk-channel-pill').textContent = state.currentChannelLabel;
    setMuteButtonState(false);

    refreshMembersList();
    goTo('screen-talk');
  } catch (err) {
    console.error(err);
    toast('Microphone error: ' + err.message + '. Please allow mic permission.', true);
    goTo('screen-lobby');
  }
}

// ---------- Mute / unmute ----------
async function toggleMute() {
  if (!state.room) return;
  const isCurrentlyEnabled = state.room.localParticipant.isMicrophoneEnabled;
  await state.room.localParticipant.setMicrophoneEnabled(!isCurrentlyEnabled);
  setMuteButtonState(isCurrentlyEnabled); // if was enabled, now muted
  refreshMembersList();
}

function setMuteButtonState(isMuted) {
  const btn = document.getElementById('mute-btn');
  const icon = document.getElementById('talk-icon');
  const circle = document.getElementById('talk-circle');
  const status = document.getElementById('talk-status');
  const sub = document.getElementById('talk-substatus');

  if (isMuted) {
    btn.textContent = '🔇 Unmute';
    btn.classList.add('active');
    icon.textContent = '🔇';
    circle.classList.add('muted');
    status.textContent = 'Muted';
    sub.textContent = 'Others can\'t hear you. Tap Unmute to talk again.';
  } else {
    btn.textContent = '🎙️ Mute';
    btn.classList.remove('active');
    icon.textContent = '🎙️';
    circle.classList.remove('muted');
    status.textContent = 'Connected';
    sub.textContent = 'Speak freely — everyone in this channel can hear you';
  }
}

// ---------- End call ----------
async function endCall() {
  if (state.isMainChannel) {
    // Just stop talking, stay in the event lobby
    if (state.room) {
      try { await state.room.localParticipant.setMicrophoneEnabled(false); } catch (e) {}
    }
    goTo('screen-lobby');
    refreshMembersList();
    return;
  }

  // We were in a private channel — return to the main event channel
  document.getElementById('loading-text').textContent = 'Returning to main channel...';
  goTo('screen-loading');
  state.currentChannelLabel = 'Main Channel';
  state.isMainChannel = true;
  state.currentChannelRoom = state.eventCode;
  try {
    await connectToRoom(state.eventCode);
    // Restore lobby UI
    if (state.eventDetails) {
      const d = state.eventDetails;
      document.getElementById('lobby-event-name').textContent = d.event;
      document.getElementById('lobby-event-meta').textContent =
        `${d.client} • ${d.venue} • ${d.date}`;
    } else {
      document.getElementById('lobby-event-name').textContent = 'Event ' + state.eventCode;
      document.getElementById('lobby-event-meta').textContent = 'You joined as ' + state.myName;
    }
    document.getElementById('lobby-event-code').textContent = state.eventCode;
    document.getElementById('current-channel-pill').textContent = 'Main Channel';
    refreshMembersList();
    goTo('screen-lobby');
  } catch (err) {
    console.error(err);
    toast('Could not return to main channel: ' + err.message, true);
    goTo('screen-choice');
  }
}

async function leaveEvent() {
  if (state.room) {
    try { await state.room.disconnect(); } catch (e) {}
    state.room = null;
  }
  document.querySelectorAll('audio[id^="audio-"]').forEach(el => el.remove());
  state.eventCode = '';
  state.eventDetails = null;
  goTo('screen-choice');
}

// ---------- Private channels ----------
function openPrivateChannelModal() {
  if (!state.room) return;
  const others = Array.from(state.room.remoteParticipants.values());
  if (others.length === 0) {
    return toast('No one else has joined yet', true);
  }
  const list = document.getElementById('private-members-list');
  list.innerHTML = others.map(p => {
    const name = p.name || p.identity;
    const initial = name.charAt(0).toUpperCase();
    return `
      <div class="member-row">
        <input type="checkbox" class="member-checkbox" data-identity="${p.identity}" />
        <div class="member-avatar">${initial}</div>
        <div class="member-name">${name}</div>
      </div>
    `;
  }).join('');
  document.getElementById('in-channel-name').value = '';
  document.getElementById('private-modal').classList.add('active');
}

function closePrivateChannelModal() {
  document.getElementById('private-modal').classList.remove('active');
}

async function createPrivateChannel() {
  const channelName = document.getElementById('in-channel-name').value.trim();
  if (!channelName) return toast('Give the channel a name', true);

  const checkboxes = document.querySelectorAll('#private-members-list input:checked');
  const selectedIdentities = Array.from(checkboxes).map(cb => cb.dataset.identity);
  if (selectedIdentities.length === 0) {
    return toast('Select at least one person', true);
  }

  // Build a unique room name for this private channel
  const privRoomName = state.eventCode + '-PRIV-' +
    Math.random().toString(36).slice(2, 7).toUpperCase();

  // Send invite to selected participants via LiveKit data channel
  const msg = JSON.stringify({
    type: 'private_channel_invite',
    channelName,
    roomName: privRoomName,
  });
  const data = new TextEncoder().encode(msg);
  await state.room.localParticipant.publishData(data, {
    reliable: true,
    destinationIdentities: selectedIdentities,
  });

  closePrivateChannelModal();
  toast(`Invite sent to ${selectedIdentities.length} ${selectedIdentities.length === 1 ? 'person' : 'people'}`);

  // Move myself to the new channel
  state.currentChannelLabel = channelName;
  state.isMainChannel = false;
  await switchToRoom(privRoomName);
}

function showInviteBanner() {
  if (!state.pendingInvite) return;
  document.getElementById('invite-from').textContent = state.pendingInvite.from;
  document.getElementById('invite-channel-name').textContent = state.pendingInvite.channelName;
  document.getElementById('invite-banner').classList.add('active');
}
function hideInviteBanner() {
  document.getElementById('invite-banner').classList.remove('active');
  state.pendingInvite = null;
}

async function acceptInvite() {
  if (!state.pendingInvite) return;
  const { roomName, channelName } = state.pendingInvite;
  hideInviteBanner();
  state.currentChannelLabel = channelName;
  state.isMainChannel = false;
  await switchToRoom(roomName);
}

function declineInvite() { hideInviteBanner(); }

async function switchToRoom(roomName) {
  document.getElementById('loading-text').textContent = 'Switching channel...';
  goTo('screen-loading');
  try {
    state.currentChannelRoom = roomName;
    await connectToRoom(roomName);
    // Auto-join conversation in private channel
    await state.room.localParticipant.setMicrophoneEnabled(true);
    document.getElementById('talk-channel-pill').textContent = state.currentChannelLabel;
    document.getElementById('talk-event-name').textContent = state.currentChannelLabel;
    setMuteButtonState(false);
    refreshMembersList();
    goTo('screen-talk');
  } catch (err) {
    console.error(err);
    toast('Could not switch channels: ' + err.message, true);
    goTo('screen-lobby');
  }
}

// ---------- Boot ----------
document.addEventListener('DOMContentLoaded', () => {
  // Pre-fill last used name
  const lastName = localStorage.getItem('hivedx-last-name');
  if (lastName) {
    document.getElementById('in-name-create').value = lastName;
    document.getElementById('in-name-join').value = lastName;
  }
  // Pre-fill today's date
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('in-date').value = today;

  // Disconnect cleanly on page close
  window.addEventListener('beforeunload', () => {
    if (state.room) state.room.disconnect();
  });
});
