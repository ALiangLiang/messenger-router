/*!
 * router
 * Copyright(c) 2013 Roman Shtylman
 * Copyright(c) 2014 Douglas Christopher Wilson
 * MIT Licensed
 */

'use strict'

/**
 * Module dependencies.
 * @private
 */

var debug = require('debug')('router')
var flatten = require('array-flatten')
var Layer = require('./lib/layer')
var methods = require('./lib//methods')
var mixin = require('utils-merge')
var url = require('url')
var qs = require('querystring');
var Route = require('./lib/route')
var setPrototypeOf = require('setprototypeof')

/**
 * Module variables.
 * @private
 */

var slice = Array.prototype.slice

/* istanbul ignore next */
var defer = typeof setImmediate === 'function' ?
  setImmediate :
  function(fn) {
    process.nextTick(fn.bind.apply(fn, arguments))
  }

/**
 * Expose `Router`.
 */

module.exports = Router

/**
 * Expose `Route`.
 */

module.exports.Route = Route

/**
 * Initialize a new `Router` with the given `options`.
 *
 * @param {object} options
 * @return {Router} which is an callable function
 * @public
 */

function Router(options) {
  if (!(this instanceof Router)) {
    return new Router(options)
  }

  var opts = options || {}

  function router(req, res, next) {
    router.handle(req, res, next)
  }

  // inherit from the correct prototype
  setPrototypeOf(router, this)

  router.caseSensitive = opts.caseSensitive
  router.mergeParams = opts.mergeParams
  router.params = {}
  router.strict = opts.strict
  router.stack = []

  return router
}

/**
 * Router prototype inherits from a Function.
 */

/* istanbul ignore next */
Router.prototype = function() {}

/**
 * Map the given param placeholder `name`(s) to the given callback.
 *
 * Parameter mapping is used to provide pre-conditions to routes
 * which use normalized placeholders. For example a _:user_id_ parameter
 * could automatically load a user's information from the database without
 * any additional code.
 *
 * The callback uses the same signature as middleware, the only difference
 * being that the value of the placeholder is passed, in this case the _id_
 * of the user. Once the `next()` function is invoked, just like middleware
 * it will continue on to execute the route, or subsequent parameter functions.
 *
 * Just like in middleware, you must either respond to the request or call next
 * to avoid stalling the request.
 *
 *  router.param('user_id', function(req, res, next, id){
 *    User.find(id, function(err, user){
 *      if (err) {
 *        return next(err)
 *      } else if (!user) {
 *        return next(new Error('failed to load user'))
 *      }
 *      req.user = user
 *      next()
 *    })
 *  })
 *
 * @param {string} name
 * @param {function} fn
 * @public
 */

Router.prototype.param = function param(name, fn) {
  if (!name) {
    throw new TypeError('argument name is required')
  }

  if (typeof name !== 'string') {
    throw new TypeError('argument name must be a string')
  }

  if (!fn) {
    throw new TypeError('argument fn is required')
  }

  if (typeof fn !== 'function') {
    throw new TypeError('argument fn must be a function')
  }

  var params = this.params[name]

  if (!params) {
    params = this.params[name] = []
  }

  params.push(fn)

  return this
}

/**
 * Dispatch a req, res into the router.
 *
 * @private
 */

Router.prototype.handle = function handle(req, res, callback) {
  if (!callback) {
    throw new TypeError('argument callback is required')
  }

  debug('dispatching %s %s', req.method, req.data[0].payload)

  var idx = 0
  var removed = ''
  var self = this
  var slashAdded = false //req.data[0].payload.substr(0, 1) === '/'
  var paramcalled = {}

  // middleware and routes
  var stack = this.stack

  // manage inter-router variables
  var parentParams = req.params
  var done = restore(callback, req, 'next', 'params')

  // setup query
  if (req.data && req.data[0] && req.data[0].payload) {
    req.query = qs.parse(url.parse(req.data[0].payload).query)
    console.log(req.query)
  }

  // setup next layer
  req.next = next

  next()

  function next(err) {
    var layerError = err === 'route' ?
      null :
      err

    // remove added slash
    if (slashAdded) {
      req.payload = req.data[0].payload.substr(1)
      slashAdded = false
    }

    // restore altered req.payload
    if (removed.length !== 0) {
      removed = ''
    }

    // signal to exit router
    if (layerError === 'router') {
      defer(done, null)
      return
    }

    // no more matching layers
    if (idx >= stack.length) {
      defer(done, layerError)
      return
    }

    // get pathname of request
    var path = getPathname(req.data[0].payload)

    if (path == null) {
      return done(layerError)
    }

    // find next matching layer
    var layer
    var match
    var route

    while (match !== true && idx < stack.length) {
      layer = stack[idx++]
      match = matchLayer(layer, path)
      route = layer.route

      if (typeof match !== 'boolean') {
        // hold on to layerError
        layerError = layerError || match
      }

      if (match !== true) {
        continue
      }

      if (!route) {
        // process non-route handlers normally
        continue
      }

      if (layerError) {
        // routes do not match with a pending error
        match = false
        continue
      }
    }

    // no match
    if (match !== true) {
      return done(layerError)
    }

    // store route for dispatch on change
    if (route) {
      req.route = route
    }

    // Capture one-time layer values
    req.params = self.mergeParams ?
      mergeParams(layer.params, parentParams) :
      layer.params
    var layerPath = layer.path

    // this should be done for the layer
    self.process_params(layer, paramcalled, req, res, function(err) {
      if (err) {
        return next(layerError || err)
      }

      if (route) {
        return layer.handle_request(req, res, next)
      }

      trim_prefix(layer, layerError, layerPath, path)
    })
  }

  function trim_prefix(layer, layerError, layerPath, path) {
    if (layerPath.length !== 0) {
      // Validate path breaks on a path separator
      var c = path[layerPath.length]
      if (c && c !== '/') {
        next(layerError)
        return
      }

      // Trim off the part of the payload that matches the route
      // middleware (.use stuff) needs to have the path stripped
      debug('trim prefix (%s) from payload %s', layerPath, req.data[0].payload)
      removed = layerPath
    }

    debug('%s %s : %s', layer.name, layerPath, req.originalUrl)

    if (layerError) {
      layer.handle_error(layerError, req, res, next)
    } else {
      layer.handle_request(req, res, next)
    }
  }
}

/**
 * Process any parameters for the layer.
 *
 * @private
 */

Router.prototype.process_params = function process_params(layer, called, req, res, done) {
  var params = this.params

  // captured parameters from the layer, keys and values
  var keys = layer.keys

  // fast track
  if (!keys || keys.length === 0) {
    return done()
  }

  var i = 0
  var name
  var paramIndex = 0
  var key
  var paramVal
  var paramCallbacks
  var paramCalled

  // process params in order
  // param callbacks can be async
  function param(err) {
    if (err) {
      return done(err)
    }

    if (i >= keys.length) {
      return done()
    }

    paramIndex = 0
    key = keys[i++]
    name = key.name
    paramVal = req.params[name]
    paramCallbacks = params[name]
    paramCalled = called[name]

    if (paramVal === undefined || !paramCallbacks) {
      return param()
    }

    // param previously called with same value or error occurred
    if (paramCalled && (paramCalled.match === paramVal ||
        (paramCalled.error && paramCalled.error !== 'route'))) {
      // restore value
      req.params[name] = paramCalled.value

      // next param
      return param(paramCalled.error)
    }

    called[name] = paramCalled = {
      error: null,
      match: paramVal,
      value: paramVal
    }

    paramCallback()
  }

  // single param callbacks
  function paramCallback(err) {
    var fn = paramCallbacks[paramIndex++]

    // store updated value
    paramCalled.value = req.params[key.name]

    if (err) {
      // store error
      paramCalled.error = err
      param(err)
      return
    }

    if (!fn) return param()

    try {
      fn(req, res, paramCallback, paramVal, key.name)
    } catch (e) {
      paramCallback(e)
    }
  }

  param()
}

/**
 * Use the given middleware function, with optional path, defaulting to "/".
 *
 * Use (like `.all`) will run for any http METHOD, but it will not add
 * handlers for those methods so OPTIONS requests will not consider `.use`
 * functions even if they could respond.
 *
 * The other difference is that _route_ path is stripped and not visible
 * to the handler function. The main effect of this feature is that mounted
 * handlers can operate without any code changes regardless of the "prefix"
 * pathname.
 *
 * @public
 */

Router.prototype.use = function use(handler) {
  var offset = 0
  var path = '/'

  // default path to '/'
  // disambiguate router.use([handler])
  if (typeof handler !== 'function') {
    var arg = handler

    while (Array.isArray(arg) && arg.length !== 0) {
      arg = arg[0]
    }

    // first arg is the path
    if (typeof arg !== 'function') {
      offset = 1
      path = handler
    }
  }

  var callbacks = flatten(slice.call(arguments, offset))

  if (callbacks.length === 0) {
    throw new TypeError('argument handler is required')
  }

  for (var i = 0; i < callbacks.length; i++) {
    var fn = callbacks[i]

    if (typeof fn !== 'function') {
      throw new TypeError('argument handler must be a function')
    }

    // add the middleware
    debug('use %o %s', path, fn.name || '<anonymous>')

    var layer = new Layer(path, {
      sensitive: this.caseSensitive,
      strict: false,
      end: false
    }, fn)

    layer.route = undefined

    this.stack.push(layer)
  }

  return this
}

/**
 * Create a new Route for the given path.
 *
 * Each route contains a separate middleware stack and VERB handlers.
 *
 * See the Route api documentation for details on adding handlers
 * and middleware to routes.
 *
 * @param {string} path
 * @return {Route}
 * @public
 */

Router.prototype.route = function route(path) {
  var route = new Route(path)

  var layer = new Layer(path, {
    sensitive: this.caseSensitive,
    strict: this.strict,
    end: true
  }, handle)

  function handle(req, res, next) {
    route.dispatch(req, res, next)
  }

  layer.route = route

  this.stack.push(layer)
  return route
}

// create Router#VERB functions
methods.concat('all').forEach(function(method) {
  if (method.toLowerCase() === 'reply' || method.toLowerCase() === 'postback')
    Router.prototype[method] = function(path) {
      var route = this.route(path)
      route[method].apply(route, slice.call(arguments, 1))
      return this
    }
  else
    Router.prototype[method] = function() {
      var route = this.route('/*')
      route[method].apply(route, slice.call(arguments, 0))
      return this
    }
})

/**
 * Get pathname of request.
 *
 * @param {IncomingMessage} req
 * @private
 */

function getPathname(payload = '/foo') {
  try {
    return url.parse(payload).pathname;
  } catch (err) {
    return undefined;
  }
}

/**
 * Match path to a layer.
 *
 * @param {Layer} layer
 * @param {string} path
 * @private
 */

function matchLayer(layer, path) {
  try {
    return layer.match(path);
  } catch (err) {
    return err;
  }
}

/**
 * Merge params with parent params
 *
 * @private
 */

function mergeParams(params, parent) {
  if (typeof parent !== 'object' || !parent) {
    return params
  }

  // make copy of parent for base
  var obj = mixin({}, parent)

  // simple non-numeric merging
  if (!(0 in params) || !(0 in parent)) {
    return mixin(obj, params)
  }

  var i = 0
  var o = 0

  // determine numeric gap in params
  while (i in params) {
    i++
  }

  // determine numeric gap in parent
  while (o in parent) {
    o++
  }

  // offset numeric indices in params before merge
  for (i--; i >= 0; i--) {
    params[i + o] = params[i]

    // create holes for the merge when necessary
    if (i < o) {
      delete params[i]
    }
  }

  return mixin(obj, params)
}

/**
 * Restore obj props after function
 *
 * @private
 */

function restore(fn, obj) {
  var props = new Array(arguments.length - 2)
  var vals = new Array(arguments.length - 2)

  for (var i = 0; i < props.length; i++) {
    props[i] = arguments[i + 2]
    vals[i] = obj[props[i]]
  }

  return function() {
    // restore vals
    for (var i = 0; i < props.length; i++) {
      obj[props[i]] = vals[i]
    }

    return fn.apply(this, arguments)
  }
}
