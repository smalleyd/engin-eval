import { createServer } from 'node:http';

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!DOCTYPE html><body><h1>Server Created</h1></body></html>');
})

server.listen(3000, "127.0.0.1", () => {
  console.log('Listening on port 3000');
});