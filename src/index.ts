import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import bonjour from 'bonjour';
import { io as ClientIO, } from 'socket.io-client';

// ----- Configuration -----
const SERVICE_TYPE = 'eventbus';
const PORT = 4000;
const NODE_NAME_FILE = path.join(__dirname, 'nodeName.txt');

// ----- Node Name Setup -----
function getFormattedDate(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
}

function getNodeName(): string {
    if (fs.existsSync(NODE_NAME_FILE)) {
        return fs.readFileSync(NODE_NAME_FILE, 'utf-8').trim();
    } else {
        const hostname = os.hostname();
        const nodeName = `${hostname}-${getFormattedDate()}`;
        fs.writeFileSync(NODE_NAME_FILE, nodeName, 'utf-8');
        return nodeName;
    }
}

const nodeName = getNodeName();
console.log(`Node name is: ${nodeName}`);

// ----- Server Setup -----
const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
    cors: {
        origin: "*",
    }
});

// Serve static files and JSON parsing
app.use(express.json());
app.use('/files', express.static('files'));

// A simple publish endpoint (for demonstration)
app.post('/publish', (req, res) => {
    const event = req.body;
    // Validate event if needed
    io.emit('event', event);
    res.sendStatus(200);
});

// On Socket.io connection
io.on('connection', (socket) => {
    console.log(`A client connected: ${socket.id}`);

    // Listen for "hello" event from newly connected clients/nodes
    socket.on('hello', (data: { name: string }) => {
        console.log(`Received hello from ${data.name}. Sending hello world back.`);
        // Send a helloReply event
        socket.emit('helloReply', { message: `Hello world, ${data.name}! From ${nodeName}.` });
    });

    socket.on('helloReply', (data: { message: string }) => {
        console.log(`Received helloReply: ${data.message}`);
    });

    socket.on('subscribe', (data: { topic: string }) => {
        console.log(`Client ${socket.id} subscribed to ${data.topic}`);
        // You could store the subscription in a map and send events accordingly.
    });

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
    });
});

// ----- Bonjour (mDNS) Setup -----
const b = bonjour();

// Publish this node's eventbus service
b.publish({ name: nodeName, type: SERVICE_TYPE, port: PORT });

// Discover other nodes on the network
b.find({ type: SERVICE_TYPE }, (service) => {
    // If we discover a node's service and it's not ourselves
    if (service.host !== os.hostname() || service.port !== PORT) {
        const targetHost = service.host === 'localhost' ? '127.0.0.1' : service.host;
        const url = `http://${targetHost}:${service.port}`;
        console.log(`Discovered another event node: ${service.name} at ${url}`);
        connectToPeer(url, service.name);
    }
});

// Keep track of connections to avoid duplicates
const connectedPeers = new Set<string>();

async function connectToPeer(baseURL: string, peerName: string) {
    if (connectedPeers.has(peerName)) {
        // Already connected
        return;
    }

    // Connect via Socket.io as a client
    const peerSocket = ClientIO(baseURL, { reconnectionAttempts: 3 });

    peerSocket.on('connect', () => {
        console.log(`Connected to peer ${peerName} at ${baseURL}`);
        connectedPeers.add(peerName);
        // Send a hello event with our name
        peerSocket.emit('hello', { name: nodeName });
    });

    peerSocket.on('helloReply', (data: { message: string }) => {
        console.log(`Peer ${peerName} says: ${data.message}`);
    });

    peerSocket.on('disconnect', () => {
        console.log(`Disconnected from peer ${peerName}`);
        connectedPeers.delete(peerName);
    });

    peerSocket.on('connect_error', (err) => {
        console.error(`Failed to connect to peer ${peerName} at ${baseURL}: ${err.message}`);
    });
}

// ----- Start the Server -----
server.listen(PORT, () => {
    console.log(`Event node server (${nodeName}) running on port ${PORT}`);
});
