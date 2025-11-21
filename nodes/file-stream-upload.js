module.exports = function (RED) {
  const fs = require('fs-extra');
  const path = require('path');
  const { v4: uuidv4 } = require('uuid');

  function FileStreamUpload(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    const uploadDir = config.directory || '/data/upload-stream';

    // Assicura che la directory di upload esista
    fs.ensureDir(uploadDir)
      .then(() => {
        node.log(`Upload directory is ready at: ${uploadDir}`);
      })
      .catch((err) => {
        node.error(`Failed to create upload directory: ${err.message}`);
        node.status({
          fill: 'red',
          shape: 'ring',
          text: 'Directory error',
        });
      });

    // Recupera il context globale di Node-RED
    const globalContext = node.context().global;

    node.on('input', async (msg, send, done) => {
      const streamId = msg.payload;
      const registry = globalContext.get('_YOU_STREAM_REGISTRY') || {};
      const fileStream = registry[streamId];

      if (!fileStream) {
        node.error(`Stream not found for id: ${streamId}`, msg);
        if (done) done(new Error(`Stream not found for id: ${streamId}`));
        return;
      }

      // Rimuovi lo stream dalla registry
      delete registry[streamId];
      globalContext.set('_YOU_STREAM_REGISTRY', registry);

      const originalFilename = msg.filename || 'unknown_file';
      const uniqueFilename = `${uuidv4()}-${originalFilename}`;
      const fullPath = path.join(uploadDir, uniqueFilename);

      node.status({ fill: 'blue', shape: 'dot', text: 'saving file' });

      try {
        const writeStream = fs.createWriteStream(fullPath);

        fileStream.pipe(writeStream);

        await new Promise((resolve, reject) => {
          writeStream.on('finish', resolve);
          writeStream.on('error', reject);
          fileStream.on('error', reject);
        });

        node.status({ fill: 'green', shape: 'dot', text: 'save complete' });

        send({
          payload: {
            path: fullPath,
            filename: uniqueFilename,
            originalFilename: originalFilename,
          },
        });

        if (done) done();
      } catch (err) {
        node.status({ fill: 'red', shape: 'ring', text: 'save failed' });
        node.error(`Failed to save stream to file: ${err.message}`, msg);
        if (done) done(err);
      }
    });
  }

  RED.nodes.registerType('file-stream-upload', FileStreamUpload);
};
