// import { createServer } from 'node:http';

/*
const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!DOCTYPE html><body><h1>Server Created</h1></body></html>');
})

server.listen(3000, "127.0.0.1", () => {
  console.log('Listening on port 3000');
});

export function xyz(a: (x: string) => string): number {
  return parseInt(a("blah"))
}

export type Colors = "first" | "second" | "third" | "fourth";
*/

const value: any = "Test";
console.log(value instanceof String); // FALSE
console.log(typeof value === "string"); // TRUE