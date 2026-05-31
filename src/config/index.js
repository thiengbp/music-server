'use strict';

module.exports = {
  log: (msg, obj) => {
    if (obj) console.log(msg, obj);
    else console.log(msg);
  }
};
