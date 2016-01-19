/*global module */

'use strict';

function bsearch(array, compare)
{
    if (array) {
        var min = 0;
        var max = array.length - 1;
        var cur;

        while (min <= max) {
            cur = (min + max) >> 1;
            var cmp = compare(array[cur]);
            if (cmp < 0) {
                min = cur + 1;
            } else if (cmp > 0) {
                max = cur - 1;
            } else {
                return cur;
            }
        }
    }
    return undefined;
}

module.exports = bsearch;
