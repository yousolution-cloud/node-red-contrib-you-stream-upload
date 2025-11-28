const fs = require('fs');
const path = require('path');

module.exports = function (RED) {
    'use strict';

    function FileResponseStreamNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.on("input", function (msg) {

            // ------------------------------------
            // Normalizza msg.res
            // ------------------------------------
            if (!msg.res && !msg._res) {
                node.error("No msg.res/msg._res present");
                return;
            }

            let res = msg.res || msg._res;

            if (res && !res.setHeader) {
                if (msg._res && typeof msg._res.setHeader === "function") {
                    res = msg._res;
                } else if (res._res && typeof res._res.setHeader === "function") {
                    res = res._res;
                }
            }

            if (!res || typeof res.write !== "function") {
                node.error("Invalid HTTP response object");
                return;
            }

            // ------------------------------------
            // Filename
            // ------------------------------------
            const filenameProp = config.filenameProperty || "filename";
            let filename = RED.util.getMessageProperty(msg, filenameProp);

            if (!filename) {
                res.status?.(400);
                return res.end("Filename missing.");
            }

            // Resolve path
            if (config.basePath) {
                filename = path.resolve(config.basePath, filename);
                // Security check: ensure we are still within base path
                if (!filename.startsWith(path.resolve(config.basePath))) {
                    node.warn(`Path traversal attempt detected: ${filename}`);
                    res.status?.(403);
                    return res.end("Access denied.");
                }
            } else {
                // If no base path, use absolute path or resolve relative to CWD
                filename = path.resolve(filename);
            }

            // Check existence
            fs.stat(filename, (err, stats) => {
                if (err) {
                    if (err.code === 'ENOENT') {
                        node.warn(`File not found: ${filename}`);
                        res.status?.(404);
                        return res.end("File not found.");
                    }
                    node.error(`Error accessing file ${filename}: ${err.message}`);
                    res.status?.(500);
                    return res.end("Internal server error.");
                }

                if (!stats.isFile()) {
                    res.status?.(404);
                    return res.end("Not a file.");
                }

                const size = stats.size;
                const basename = path.basename(filename);
                const contentType = msg.mimetype || config.contentType || "application/octet-stream";
                const disposition = config.contentDisposition || "attachment";

                // headers
                try {
                    res.setHeader("Content-Type", contentType);
                    res.setHeader("Content-Disposition", `${disposition}; filename="${basename}"`);
                    res.setHeader("Content-Length", size);
                } catch (err) {
                    res.writeHead(200, {
                        "Content-Type": contentType,
                        "Content-Disposition": `${disposition}; filename="${basename}"`,
                        "Content-Length": size
                    });
                }

                const stream = fs.createReadStream(filename);

                // Manual pump to handle non-standard response objects
                stream.on('data', (chunk) => {
                    const ok = res.write(chunk);
                    if (!ok) {
                        stream.pause();
                        res.once('drain', () => stream.resume());
                    }
                });

                stream.on('end', () => {
                    res.end();
                });

                stream.on('error', (err) => {
                    node.error(`Stream error for file ${filename}: ${err.message}`);
                    if (!res.writableEnded) {
                        res.end("Stream error.");
                    }
                });

                // client disconnect
                res.on("close", () => {
                    if (!res.writableEnded) {
                        node.warn(`Client disconnected (File ${filename})`);
                        stream.destroy();
                    }
                });
            });
        });
    }

    RED.nodes.registerType("file-response-stream", FileResponseStreamNode);
};
