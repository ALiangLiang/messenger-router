/*!
 * methods
 * Copyright(c) 2013-2014 TJ Holowaychuk
 * Copyright(c) 2015-2016 Douglas Christopher Wilson
 * Copyright(c) 2017 ALiangLiang
 * MIT Licensed
 */

'use strict'

/**
 * Module exports.
 * @public
 */

module.exports = getBasicNodeMethods()

/**
 * Get the types of messenger platform webhook.
 * @private
 */

function getBasicNodeMethods() {
    return [
        'text',
        'reply',
        'image',
        'audio',
        'file',
        'fallback',
        'location',
        'video',
        'delivery',
        'read',
        'postback'
    ]
}
