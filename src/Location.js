/*global module */

'use strict';

function Location(file, start, end, type)
{
    this.file = file;
    this.start = start;
    this.end = end;
    this.type = type || 0;
    // ### FOR DEBUG
    this.key = file + ',' + start;
}
Location.REFERENCE = 3;
Location.MAYBE_REFERENCE = 2;
Location.DEFINITION = 1;
Location.compare = function(l, r) {
    let ret = l.start - r.start;
    if (!ret)
        ret = l.end - r.end;
    return ret;
};

Location.prototype = {
    toString: function() {
        var ret = this.file + ',' + this.start + ' ';
        ret += "File: " + this.file + " ";
        ret += "Start: " + this.start;
        ret += " End: " + this.end;
        switch (this.type) {
        case Location.REFERENCE: ret += "Type: Reference";
        case Location.MAYBE_REFERENCE: ret += "Type: MaybeReference";
        case Location.DEFINITION: ret += "Type: Definition";
        }
        return ret;
    },
    get index() { return this.start; }
};

module.exports = Location;
