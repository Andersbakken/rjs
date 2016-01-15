/*global require, module */

var Location = require('./Location');

function SourceCode(file) {
    this.mainFile = file;
    this.files = [];
    this.indexTime = new Date();
    this.code = "";
};

SourceCode.prototype.resolve = function resolveLocation(idx) {
    for (var i=0; i<this.files.length; ++i) {
        if (idx < this.files[i].length)
            return new Location(this.files[i].file, idx);
        idx -= this.files[i].length;
    }
    return undefined;
};

module.exports = SourceCode;
