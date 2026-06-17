/* =========================================================
   HiveDX Event Clearcoms — frontend logic
   Plain browser JavaScript. Talks to /api/token for LiveKit auth.
   ========================================================= */

// ---------- Config ----------
const TOKEN_ENDPOINT = '/api/token';

// ---------- App state ----------
const state = {
  myName: '',
  myIdentity: '',
  eventCode: '',
  eventDetails: null, // { client, event, venue, date }
  isAdmin: false,     // creator of the event = admin
  room: null,
  currentChannelRoom: '',
  currentChannelLabel: 'Main Channel',
  isMainChannel: true,
  pendingInvite: null,
};

// ---------- Screen navigation ----------
function goTo(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
  // Scroll to top of new screen
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ---------- Toast ----------
function toast(msg, kind = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (kind === 'error' ? ' error' : kind === 'success' ? ' success' : '');
  t.style.display = 'block';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { t.style.display = 'none'; }, 3000);
}

// ---------- Event code ----------
function generateEventCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'HIVE-';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function safeStore(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }
function safeRead(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

// ---------- Event creation (Screen 3) ----------
function submitCreateEvent() {
  try {
    const client = (document.getElementById('in-client').value || '').trim();
    const event = (document.getElementById('in-event').value || '').trim();
    const venue = (document.getElementById('in-venue').value || '').trim();
    const date = (document.getElementById('in-date').value || '').trim();
    const myName = (document.getElementById('in-name-create').value || '').trim();

    if (!client || !event || !venue || !date || !myName) {
      return toast('Please fill in every field', 'error');
    }

    const code = generateEventCode();
    const details = { client, event, venue, date };

    safeStore('hivedx-event-' + code, JSON.stringify(details));
    safeStore('hivedx-last-name', myName);
    safeStore('hivedx-admin-of-' + code, '1');

    state.myName = myName;
    state.eventCode = code;
    state.eventDetails = details;
    state.isAdmin = true;

    document.getElementById('generated-code').textContent = code;
    goTo('screen-created');
  } catch (err) {
    console.error('submitCreateEvent error:', err);
    toast('Could not create event: ' + (err.message || 'unknown error'), 'error');
  }
}

function copyCode() {
  const code = document.getElementById('generated-code').textContent;
  navigator.clipboard.writeText(code).then(
    () => toast('Code copied!', 'success'),
    () => toast('Could not copy — please copy manually', 'error'),
  );
}

function enterEventAsCreator() {
  enterLobby(state.eventCode, state.myName, state.eventDetails);
}

// ---------- Event joining (Screen 4) ----------
function joinEvent() {
  const code = (document.getElementById('in-code').value || '').trim().toUpperCase();
  const myName = (document.getElementById('in-name-join').value || '').trim();
  if (!code || !myName) return toast('Please enter both fields', 'error');

  // If this device created the event, recover details + admin flag from localStorage
  const stored = safeRead('hivedx-event-' + code);
  const details = stored ? JSON.parse(stored) : null;
  const adminFlag = safeRead('hivedx-admin-of-' + code) === '1';

  state.myName = myName;
  state.eventCode = code;
  state.eventDetails = details;
  state.isAdmin = adminFlag;
  safeStore('hivedx-last-name', myName);

  enterLobby(code, myName, details);
}

// ---------- Lobby (Screen 5) ----------
async function enterLobby(eventCode, displayName, details) {
  document.getElementById('loading-text').textContent = 'Connecting to event…';
  goTo('screen-loading');

  try {
    state.myIdentity = displayName + '-' + Math.random().toString(36).slice(2, 8);
    state.currentChannelRoom = eventCode;
    state.currentChannelLabel = 'Main Channel';
    state.isMainChannel = true;

    await connectToRoom(eventCode);

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

    // Admin-only UI
    document.getElementById('admin-badge').style.display = state.isAdmin ? 'inline-flex' : 'none';
    document.getElementById('btn-create-channel').style.display = state.isAdmin ? 'inline-flex' : 'none';

    refreshMembersList();
    goTo('screen-lobby');

    if (!state.eventDetails) requestEventDetails();
  } catch (err) {
    console.error(err);
    toast('Failed to connect: ' + err.message, 'error');
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
  return await res.json();
}

async function connectToRoom(roomName) {
  if (state.room) {
    try { await state.room.disconnect(); } catch (e) {}
    state.room = null;
  }

  const { token, wsUrl } = await fetchToken(roomName, state.myIdentity, state.myName);

  // Build room with high-quality voice settings
  const LK = window.LivekitClient;
  const audioPreset = LK.AudioPresets?.speech || { maxBitrate: 24000 };

  const room = new LK.Room({
    adaptiveStream: true,
    dynacast: true,
    // Browser-level audio processing — dramatically improves clarity
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
      sampleRate: 48000,
    },
    publishDefaults: {
      audioPreset,
      red: true, // Redundant encoding — resilient to packet loss
      dtx: true, // Discontinuous transmission — saves bandwidth in silence
      stopMicTrackOnMute: false,
    },
  });

  room.on(LK.RoomEvent.ParticipantConnected, onParticipantConnected);
  room.on(LK.RoomEvent.ParticipantDisconnected, onParticipantChange);
  room.on(LK.RoomEvent.TrackSubscribed, onTrackSubscribed);
  room.on(LK.RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
  room.on(LK.RoomEvent.TrackMuted, onParticipantChange);
  room.on(LK.RoomEvent.TrackUnmuted, onParticipantChange);
  room.on(LK.RoomEvent.ActiveSpeakersChanged, onActiveSpeakersChange);
  room.on(LK.RoomEvent.DataReceived, onDataReceived);
  room.on(LK.RoomEvent.Disconnected, onDisconnected);

  await room.connect(wsUrl, token);
  state.room = room;
}

function onTrackSubscribed(track, publication, participant) {
  if (track.kind === 'audio') {
    const el = track.attach();
    el.id = 'audio-' + participant.identity;
    el.autoplay = true;
    el.playsInline = true;
    // Pin to body so iOS doesn't pause it
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
  if (state.isMainChannel && state.eventDetails && participant?.identity) {
    setTimeout(() => broadcastEventDetails([participant.identity]), 500);
  }
}

function onActiveSpeakersChange(speakers) {
  refreshMembersList();
}

function onDataReceived(payload, participant) {
  try {
    const msg = JSON.parse(new TextDecoder().decode(payload));
    if (msg.type === 'private_channel_invite') {
      state.pendingInvite = {
        from: participant?.name || participant?.identity || 'Someone',
        channelName: msg.channelName,
        roomName: msg.roomName,
      };
      showInviteBanner();
    } else if (msg.type === 'event_details' && !state.eventDetails) {
      state.eventDetails = msg.details;
      const d = msg.details;
      document.getElementById('lobby-event-name').textContent = d.event;
      document.getElementById('lobby-event-meta').textContent =
        `${d.client} • ${d.venue} • ${d.date}`;
    } else if (msg.type === 'request_event_details' && state.eventDetails && state.isMainChannel) {
      broadcastEventDetails([participant.identity]);
    }
  } catch (e) { /* ignore */ }
}

async function broadcastEventDetails(toIdentities) {
  if (!state.room || !state.eventDetails) return;
  const data = new TextEncoder().encode(JSON.stringify({ type: 'event_details', details: state.eventDetails }));
  try {
    await state.room.localParticipant.publishData(data, { reliable: true, destinationIdentities: toIdentities });
  } catch (e) {}
}

async function requestEventDetails() {
  if (!state.room || state.eventDetails) return;
  const data = new TextEncoder().encode(JSON.stringify({ type: 'request_event_details' }));
  try { await state.room.localParticipant.publishData(data, { reliable: true }); } catch (e) {}
}

function onDisconnected() {
  document.querySelectorAll('audio[id^="audio-"]').forEach(el => el.remove());
}

// ---------- Members list ----------
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
    const name = (p.name || p.identity).split('-')[0];
    const initial = name.charAt(0).toUpperCase();
    const micPub = Array.from(p.trackPublications.values()).find(t => t.kind === 'audio');
    const hasMicPub = !!micPub;
    const isLive = hasMicPub && !micPub.isMuted;
    let status, statusClass;
    if (!hasMicPub) { status = 'In lobby'; statusClass = ''; }
    else if (isLive) { status = 'Live'; statusClass = 'live'; }
    else { status = 'Muted'; statusClass = 'muted'; }
    const adminTag = (isMe && state.isAdmin) ? ' <span class="member-status admin">Admin</span>' : '';
    return `
      <div class="member-row">
        <div class="member-avatar">${initial}</div>
        <div class="member-name">${escapeHtml(name)}${isMe ? ' (you)' : ''}</div>
        <div class="member-status ${statusClass}">${status}</div>
        ${adminTag}
      </div>
    `;
  }).join('');

  lobbyList.innerHTML = html || '<div class="empty-list-msg">No one else yet.</div>';
  talkList.innerHTML = html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ---------- Join conversation (Screen 6) ----------
async function joinConversation() {
  if (!state.room) return toast('Not connected', 'error');
  document.getElementById('loading-text').textContent = 'Opening microphone…';
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
    toast('Microphone error: ' + err.message + '. Please allow mic permission.', 'error');
    goTo('screen-lobby');
  }
}

// ---------- Mute / unmute ----------
async function toggleMute() {
  if (!state.room) return;
  const isEnabled = state.room.localParticipant.isMicrophoneEnabled;
  await state.room.localParticipant.setMicrophoneEnabled(!isEnabled);
  setMuteButtonState(isEnabled);
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
    btn.classList.add('muted');
    icon.textContent = '🔇';
    circle.classList.add('muted');
    status.textContent = 'Muted';
    sub.textContent = 'Others can\'t hear you. Tap Unmute to talk again.';
  } else {
    btn.textContent = '🎙️ Mute';
    btn.classList.remove('muted');
    icon.textContent = '🎙️';
    circle.classList.remove('muted');
    status.textContent = 'Connected';
    sub.textContent = 'Speak freely — everyone in this channel can hear you';
  }
}

// ---------- End call ----------
async function endCall() {
  if (state.isMainChannel) {
    if (state.room) {
      try { await state.room.localParticipant.setMicrophoneEnabled(false); } catch (e) {}
    }
    goTo('screen-lobby');
    refreshMembersList();
    return;
  }

  // Returning from a private channel to main
  document.getElementById('loading-text').textContent = 'Returning to main channel…';
  goTo('screen-loading');
  state.currentChannelLabel = 'Main Channel';
  state.isMainChannel = true;
  state.currentChannelRoom = state.eventCode;
  try {
    await connectToRoom(state.eventCode);
    if (state.eventDetails) {
      const d = state.eventDetails;
      document.getElementById('lobby-event-name').textContent = d.event;
      document.getElementById('lobby-event-meta').textContent = `${d.client} • ${d.venue} • ${d.date}`;
    } else {
      document.getElementById('lobby-event-name').textContent = 'Event ' + state.eventCode;
      document.getElementById('lobby-event-meta').textContent = 'You joined as ' + state.myName;
    }
    document.getElementById('lobby-event-code').textContent = state.eventCode;
    document.getElementById('current-channel-pill').textContent = 'Main Channel';
    document.getElementById('btn-create-channel').style.display = state.isAdmin ? 'inline-flex' : 'none';
    refreshMembersList();
    goTo('screen-lobby');
  } catch (err) {
    console.error(err);
    toast('Could not return to main channel: ' + err.message, 'error');
    goTo('screen-choice');
  }
}

async function leaveEvent() {
  if (state.room) { try { await state.room.disconnect(); } catch (e) {} state.room = null; }
  document.querySelectorAll('audio[id^="audio-"]').forEach(el => el.remove());
  state.eventCode = '';
  state.eventDetails = null;
  state.isAdmin = false;
  goTo('screen-choice');
}

// ---------- Private channels ----------
function openPrivateChannelModal() {
  if (!state.isAdmin) {
    return toast('Only the event admin can create private channels', 'error');
  }
  if (!state.room) return;
  const others = Array.from(state.room.remoteParticipants.values());
  const list = document.getElementById('private-members-list');
  if (others.length === 0) {
    list.innerHTML = '<div class="empty-list-msg">No one else has joined yet. You can still create the channel and invite people later.</div>';
  } else {
    list.innerHTML = others.map(p => {
      const name = (p.name || p.identity).split('-')[0];
      const initial = name.charAt(0).toUpperCase();
      return `
        <div class="member-row">
          <input type="checkbox" class="member-checkbox" data-identity="${escapeAttr(p.identity)}" />
          <div class="member-avatar">${initial}</div>
          <div class="member-name">${escapeHtml(name)}</div>
        </div>
      `;
    }).join('');
  }
  document.getElementById('in-channel-name').value = '';
  document.getElementById('private-modal').classList.add('active');
}

function escapeAttr(s) { return escapeHtml(s); }

function closePrivateChannelModal() {
  document.getElementById('private-modal').classList.remove('active');
}

async function createPrivateChannel() {
  const channelName = (document.getElementById('in-channel-name').value || '').trim();
  if (!channelName) return toast('Give the channel a name', 'error');

  const checkboxes = document.querySelectorAll('#private-members-list input:checked');
  const selectedIdentities = Array.from(checkboxes).map(cb => cb.dataset.identity);

  const privRoomName = state.eventCode + '-PRIV-' + Math.random().toString(36).slice(2, 7).toUpperCase();

  if (selectedIdentities.length > 0) {
    const data = new TextEncoder().encode(JSON.stringify({
      type: 'private_channel_invite',
      channelName,
      roomName: privRoomName,
    }));
    try {
      await state.room.localParticipant.publishData(data, { reliable: true, destinationIdentities: selectedIdentities });
      toast(`Invite sent to ${selectedIdentities.length} ${selectedIdentities.length === 1 ? 'person' : 'people'}`, 'success');
    } catch (e) { console.warn('invite send failed', e); }
  } else {
    toast('Channel created. You can invite people later.', 'success');
  }

  closePrivateChannelModal();
  state.currentChannelLabel = channelName;
  state.isMainChannel = false;
  await switchToRoom(privRoomName);
}

function showInviteBanner() {
  if (!state.pendingInvite) return;
  document.getElementById('invite-from').textContent = state.pendingInvite.from.split('-')[0];
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
  document.getElementById('loading-text').textContent = 'Switching channel…';
  goTo('screen-loading');
  try {
    state.currentChannelRoom = roomName;
    await connectToRoom(roomName);
    await state.room.localParticipant.setMicrophoneEnabled(true);
    document.getElementById('talk-channel-pill').textContent = state.currentChannelLabel;
    document.getElementById('talk-event-name').textContent = state.currentChannelLabel;
    setMuteButtonState(false);
    refreshMembersList();
    goTo('screen-talk');
  } catch (err) {
    console.error(err);
    toast('Could not switch channels: ' + err.message, 'error');
    goTo('screen-lobby');
  }
}

// ---------- Boot ----------
document.addEventListener('DOMContentLoaded', () => {
  const lastName = safeRead('hivedx-last-name');
  if (lastName) {
    document.getElementById('in-name-create').value = lastName;
    document.getElementById('in-name-join').value = lastName;
  }
  document.getElementById('in-date').value = new Date().toISOString().split('T')[0];

  window.addEventListener('beforeunload', () => {
    if (state.room) state.room.disconnect();
  });
});
