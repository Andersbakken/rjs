/*global module */

function Location(file, start, end, type)
{
    this.file = file;
    this.start = start;
    this.end = end;
    this.type = type || 0;
}
Location.REFERENCE = 3;
Location.MAYBE_REFERENCE = 2;
Location.DEFINITION = 1;

Location.prototype = {
    toString: function() {
        var ret = this.file + ',' + this.start + ' ';
        ret += "File: " + this.file + " ";
        ret += "Start: " + this.start;
        ret += " End: " + this.end;
        switch (this.type) {
        case this.REFERENCE: ret += "Type: Reference";
        case this.MAYBE_REFERENCE: ret += "Type: MaybeReference";
        case this.DEFINITION: ret += "Type: Definition";
        }
        return ret;
    },
    get index() { return this.start; }
};

module.exports = Location;
