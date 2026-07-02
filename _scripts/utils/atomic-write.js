// Escrita atômica: grava em arquivo temporário no mesmo diretório e renomeia.
// Evita banco JSON corrompido se o processo morrer no meio do write
// (rename é atômico no mesmo filesystem).
'use strict';

const fs   = require('fs');
const path = require('path');

function atomicWriteFileSync(file, data, options) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp-${process.pid}`);
  fs.writeFileSync(tmp, data, options);
  fs.renameSync(tmp, file);
}

module.exports = { atomicWriteFileSync };
