# @yousolution/node-red-contrib-you-upload-stream

A collection of Node-RED nodes for handling file streams, including multipart uploads, filesystem operations, and PostgreSQL Large Objects.

## Installation

Run the following command in your Node-RED user directory - typically `~/.node-red`:

```bash
npm install @yousolution/node-red-contrib-you-upload-stream
```

## Nodes

### stream-upload

Creates an HTTP endpoint specifically designed for streaming file uploads. It handles `multipart/form-data` POST requests and outputs a readable stream of the file content.

**Usage:**
1.  Configure the **Endpoint** (e.g., `/upload-stream`).
2.  Send a POST request with a file to that endpoint.
3.  The node outputs `msg.payload` as a stream, which can be piped to other nodes.
4.  **Fields**: Any additional text fields sent in the multipart request (must be sent **before** the file) are available in `msg.fields`.
5.  **Binary Uploads**: Supports raw binary uploads (e.g., `application/octet-stream`). The filename can be specified via `Content-Disposition` or `x-filename` header.

### file-stream-upload

Saves a file stream to a specified directory on the local filesystem.

**Usage:**
1.  Connect a node that outputs a stream (like `stream-upload`) to this node.
2.  Configure the **Directory** where files should be saved.
3.  The node saves the file with a unique name (UUID + original filename) and outputs the file path.

### pg-stream-upload

Uploads a file stream directly to a PostgreSQL database as a Large Object.

**Usage:**
1.  Connect a node that outputs a stream to this node.
2.  Configure the **PostgreSQL** connection.
3.  The node streams the data to a new Large Object and outputs the Object ID (OID).

### pg-direct-download

Creates a direct HTTP GET endpoint to download a PostgreSQL Large Object stream.

**Usage:**
1.  Configure the **PostgreSQL** connection and **Endpoint** (e.g., `/pg-download`).
2.  Access the URL `http://<node-red>/pg-download/<OID>`.
3.  The node streams the Large Object with the specified OID directly to the client.

### file-direct-download

Creates a direct HTTP GET endpoint to download files from the local filesystem.

**Usage:**
1.  Configure the **Base Path** (directory to serve files from) and **Endpoint** (e.g., `/file-download`).
2.  Access the URL `http://<node-red>/file-download/<filename>`.
3.  The node streams the requested file from the Base Path to the client.
4.  **Security**: Prevents directory traversal attacks.

## License

MIT
