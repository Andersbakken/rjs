/*global module */

function Location(file, start, end, type)
{
    this.file = file;
    this.start = start;
    this.end = end;
    this.type = type || 0;
}

Location.prototype = {
    toString: function() {
        var ret = "";
        if (this.file)
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
    get index() { return this.start; },
    REFERENCE: 5,
    MAYBE_REFERENCE: 3,
    DEFINITION: 0
};

module.exports = Location;
