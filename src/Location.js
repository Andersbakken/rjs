/*global module */

function Location()
{
    this.start = arguments[0];
    this.end = arguments[1];
    this.rank = arguments[2];
    this.file = arguments[3];
}

Location.prototype.toString = function() {
    var ret = "";
    if (this.file)
        ret += "File: " + this.file + " ";
    ret += "Start: " + this.start;
    ret += " End: " + this.end;
    if (this.rank)
        ret += " Rank: " + this.rank;
    return ret;
};

module.exports = Location;
