module.exports = function (RED) {
  const fs = require('fs-extra');
  const path = require('path');
  const { Readable } = require('stream');
  const { v4: uuidv4 } = require('uuid');

  function FileStreamUpload(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    const uploadDir = config.directory || '/data/upload-stream';

    // Assicura che la directory di upload esista.
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

    node.on('input', async (msg, send, done) => {
      const fileStream = msg.payload;
      const originalFilename = msg.filename || 'unknown_file';

      if (!(fileStream instanceof Readable)) {
        if (done) {
          done();
        } // Acknowledge message, but do nothing.
        return;
      }

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

        if (done) {
          done();
        }
      } catch (err) {
        node.status({ fill: 'red', shape: 'ring', text: 'save failed' });
        node.error(`Failed to save stream to file: ${err.message}`, msg);
        if (done) {
          done(err);
        }
      }
    });
  }

  RED.nodes.registerType('file-stream-upload', FileStreamUpload);
};
