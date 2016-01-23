/*global require, module */

'use strict';

var Location = require('./Location');

function SourceCode(file) {
    this.mainFile = file;
    this.files = [];
    this.indexTime = new Date();
    this.code = "";
};

SourceCode.prototype = {
    resolve: function(arg) {
        var start;
        var end;
        var rank;
        if (arg instanceof Array) {
            start = arg[0];
            end = arg[1];
            rank = arg[2];
        } else {
            start = arg;
        }
        var removed = {};
        // console.log("resolving", arg.toString());
        for (var i=0; i<this.files.length; ++i) {
            // console.log(start, end, "looking at", this.files[i].length, this.files[i].file);
            if (start < this.files[i].length) {
                var cashback = removed[this.files[i].file] || 0;
                // console.log("RETURNING", this.files[i].file, start, end, rank, removed, cashback);
                if (end != undefined)
                    end += cashback;
                return new Location(this.files[i].file, start + cashback, end, rank);
            }
            if (!removed[this.files[i].file]) {
                removed[this.files[i].file] = this.files[i].length;
            } else {
                removed[this.files[i].file] += this.files[i].length;
            }
            // console.log(removed);
            start -= this.files[i].length;
            if (end != undefined)
                end -= this.files[i].length;
        }
        return undefined;
    },
    all: function() {
        var ret = [];
        for (var i=0; i<this.files.length; ++i) {
            if (ret.indexOf(this.files[i].file) == -1) {
                ret.push(this.files[i].file);
            }
        }
        return ret;
    },
    contains: function(file) {
        for (var i=0; i<this.files.length; ++i) {
            if (file === this.files[i].file)
                return true;
        }
        return false;
    }
};

module.exports = SourceCode;
