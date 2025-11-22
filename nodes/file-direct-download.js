const fs = require('fs');
const path = require('path');

module.exports = function (RED) {
    'use strict';

    function FileDirectDownloadNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        const basePath = config.basePath || '.';
        const endpoint = (config.endpoint || '/file-download').startsWith('/')
            ? config.endpoint
            : '/' + config.endpoint;
        const routePath = `${endpoint}/:filename`;

        const handler = function (req, res) {
            const filename = req.params.filename;

            // Basic directory traversal protection: disallow path separators
            if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
                node.warn(`Invalid filename attempt: ${filename}`);
                return res.status(400).send('Invalid filename.');
            }

            const filePath = path.resolve(basePath, filename);

            // Ensure the resolved path is still within the base path (extra safety)
            if (!filePath.startsWith(path.resolve(basePath))) {
                node.warn(`Path traversal attempt detected: ${filePath}`);
                return res.status(403).send('Access denied.');
            }

            fs.stat(filePath, (err, stats) => {
                if (err) {
                    if (err.code === 'ENOENT') {
                        node.warn(`File not found: ${filePath}`);
                        return res.status(404).send('File not found.');
                    }
                    node.error(`Error accessing file ${filePath}: ${err.message}`);
                    return res.status(500).send('Internal server error.');
                }

                if (!stats.isFile()) {
                    return res.status(404).send('Not a file.');
                }

                res.setHeader('Content-Length', stats.size);
                res.setHeader(
                    'Content-Type',
                    config.contentType || 'application/octet-stream'
                );
                res.setHeader(
                    'Content-Disposition',
                    `attachment; filename="${filename}"`
                );

                const stream = fs.createReadStream(filePath);
                stream.pipe(res);

                stream.on('error', (streamErr) => {
                    node.error(`Stream error for file ${filename}: ${streamErr.message}`);
                    if (!res.headersSent) {
                        res.status(500).send('Stream error.');
                    }
                });
            });
        };

        RED.httpNode.get(routePath, handler);
        node.log(`Registered file direct download route: GET ${routePath}`);

        node.on('close', (done) => {
            const router = RED.httpNode.app._router.stack;
            for (let i = router.length - 1; i >= 0; i--) {
                const layer = router[i];
                if (
                    layer.route &&
                    layer.route.path === routePath &&
                    layer.route.methods.get
                ) {
                    router.splice(i, 1);
                }
            }
            node.log(`Unregistered file direct download route: GET ${routePath}`);
            done();
        });
    }

    RED.nodes.registerType('file-direct-download', FileDirectDownloadNode);
};
