// stream-upload.js - MODIFICATO per essere agnostico e inviare lo stream
module.exports = function (RED) {
  const Busboy = require('busboy');

  function StreamUpload(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    const endpoint = '/upload-stream';

    const postHandler = (req, res) => {
      const busboy = Busboy({ headers: req.headers });

      busboy.on('file', (fieldname, file, info) => {
        const filename = info.filename || 'unknown_file';

        // Invia un messaggio al flow di Node-RED.
        // Il payload è lo stream del file stesso.
        node.log(`Forwarding stream for file: ${filename}`);
        node.send({
          payload: file,
          filename: filename,
          mimetype: info.mimeType,
        });
      });

      busboy.on('finish', () => {
        // Rispondi al client HTTP che lo stream è stato ricevuto
        // e inoltrato con successo al flow.
        if (!res.headersSent) {
          res.status(200).json({
            status: 'ok',
            message: 'Stream forwarded to Node-RED flow',
          });
        }
      });

      busboy.on('error', (err) => {
        node.error('Busboy error: ' + err.toString(), err);
        if (!res.headersSent) {
          res.status(500).json({ error: err.message });
        }
      });

      req.pipe(busboy);
    };

    RED.httpNode.post(endpoint, postHandler);

    node.on('close', () => {
      // L'endpoint viene rimosso automaticamente dalla logica di base di Node-RED,
      // quindi non è necessario fare nulla di specifico qui per la pulizia.
    });

    node.log('Stream Upload in ascolto su: POST ' + endpoint);
  }

  RED.nodes.registerType('stream-upload', StreamUpload);
};
