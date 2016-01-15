/*global module */

function Location(file, start, end, rank)
{
    this.file = file;
    this.start = start;
    this.end = end;
    this.rank = rank || 0;
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

module.exports.Location = Location;
