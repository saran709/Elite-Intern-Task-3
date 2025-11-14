# Real-time Chat (React + Socket.IO)

This project is a simple real-time group chat app with typing indicators built using:

- Server: Node.js + Express + Socket.IO
- Client: React (Vite) + socket.io-client

Quick start (PowerShell):

1) Run server

```powershell
cd "C:\Users\saran\Music\elite intern\task 3\server"
npm install
npm run dev
```

2) Run client

```powershell
cd "C:\Users\saran\Music\elite intern\task 3\client"
npm install
npm run dev
```

Open the client URL (printed by Vite, usually `http://localhost:5173`) and join a room with a name.

Notes:
- Server listens on port `4000` by default.
- The client connects to `http://localhost:4000` by default; change `VITE_SERVER_URL` in client's `.env` if needed.

Docker (optional)

You can run both services with Docker Compose. From the project root:

```powershell
docker-compose build
docker-compose up
```

This builds the server and the client (client is built with `VITE_SERVER_URL=http://server:4000`) and serves the client via nginx on port `5173` (mapped to container port 80). The server persists messages to `server/data/messages.json` which is mounted as a volume.

Examples and usage

- Gravatar avatars:
	- When joining a room, provide an email in the sidebar (optional). If provided, messages you send will include that email and other clients will render your Gravatar identicon.
	- If your browser supports Web Crypto, the client computes the MD5 hash of your email to request Gravatar. There's a JS fallback so identicons remain deterministic even in older browsers.

- Reactions:
	- Click an emoji under a message to add your reaction. Clicking again will remove your reaction (you will be asked to confirm removal).
	- Reactions are persisted in `server/data/messages.json` and broadcast to all users in the room.

- Admin controls (per-room):
	- The first user to join a room becomes the admin.
	- The admin sees a `Kick` button next to each other user in the sidebar. Clicking it will remove the target user from the room (force disconnect).
	- If the admin disconnects, admin rights are automatically assigned to the next connected user in the room.

- Edit / Delete messages:
	- Authors (message owners) and room admins can edit or delete messages.
	- Click `Edit` to make inline changes, then `Save` to send the update to the server. Edited messages are marked `(edited)` in the UI.
	- Click `Delete` to remove a message (you'll be asked to confirm). Deletion is broadcast to the room and persisted.


