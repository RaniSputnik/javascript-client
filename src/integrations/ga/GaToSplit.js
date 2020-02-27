import { isString, isFinite, unicAsStrings } from '../../utils/lang';
import logFactory from '../../utils/logger';
import {
  validateEvent,
  validateEventValue,
  validateEventProperties,
  validateKey,
  validateTrafficType,
} from '../../utils/inputValidation';
const log = logFactory('splitio-ga-to-split');

/**
 * Provides a plugin to use with analytics.js, accounting for the possibility
 * that the global command queue has been renamed or not yet defined.
 * @param {string} pluginName The plugin name identifier.
 * @param {Function} pluginConstructor The plugin constructor function.
 */
function providePlugin(pluginName, pluginConstructor) {
  // get reference to global command queue. Init it if not defined yet.
  const gaAlias = window.GoogleAnalyticsObject || 'ga';
  window[gaAlias] = window[gaAlias] || function (...args) {
    (window[gaAlias].q = window[gaAlias].q || []).push(args);
  };

  // provides the plugin for use with analytics.js.
  window[gaAlias]('provide', pluginName, pluginConstructor);
}

// Default filter: accepts all hits
export function defaultFilter() { return true; }

// Default mapping: object used for building the default mapper from hits to Split events
// @TODO review default mapping.
const defaultMapping = {
  eventTypeId: {
    // pageview: 'page',
    // screenview: 'screenName',
    // event: 'eventAction',
    // social: 'socialAction',
    // timing: 'timingVar',
  },
  eventValue: {
    event: 'eventValue',
    timing: 'timingValue',
  },
  eventProperties: {
    pageview: ['page'],
    screenview: ['screenName'],
    event: ['eventCategory', 'eventAction', 'eventLabel'],
    social: ['socialNetwork', 'socialAction', 'socialTarget'],
    timing: ['timingCategory', 'timingVar', 'timingLabel'],
  }
};

/**
 * Build a mapper function based on a mapping object
 *
 * @param {object} mapping
 */
function mapperBuilder(mapping) {
  return function (model) {
    const hitType = model.get('hitType');

    const eventTypeId = model.get(mapping.eventTypeId[hitType] || 'hitType');

    const value = model.get(mapping.eventValue[hitType]);

    const properties = {};
    const fields = mapping.eventProperties[hitType];
    if (fields) {
      for (let i = 0; i < fields.length; i++) {
        properties[fields[i]] = model.get(fields[i]);
      }
    }

    return {
      eventTypeId,
      value,
      properties,
    };
  };
}

export const defaultMapper = mapperBuilder(defaultMapping);

export const defaultPrefix = 'ga';

/**
 * Return a new list of identities removing invalid and duplicated ones.
 *
 * @param {Array} identities list of identities
 * @returns list of valid and unique identities, or undefined if `identities` is not an array.
 */
export function validateIdentities(identities) {
  if (!Array.isArray(identities))
    return undefined;

  // Remove duplicated identities
  const uniqueIdentities = unicAsStrings(identities);

  // Filter based on rum-agent identities validator
  return uniqueIdentities.filter(identity => {
    if (!identity)
      return false;

    const maybeKey = identity.key;
    const maybeTT = identity.trafficType;

    if (!isString(maybeKey) && !isFinite(maybeKey))
      return false;
    if (!isString(maybeTT))
      return false;

    return true;
  });
}

/**
 * Validates if a given object is a EventData instance, and logs corresponding warnings.
 *
 * @param {EventData} data event data instance to validate. Precondition: data != undefined
 * @returns {boolean} Whether the data instance is a valid EventData or not.
 */
export function validateEventData(data) {
  if (!validateEvent(data.eventTypeId, 'splitio-ga-to-split:mapper'))
    return false;

  if (validateEventValue(data.value, 'splitio-ga-to-split:mapper') === false)
    return false;

  const { properties } = validateEventProperties(data.properties, 'splitio-ga-to-split:mapper');
  if (properties === false)
    return false;

  if (data.timestamp && !isFinite(data.timestamp))
    return false;

  if (data.key && validateKey(data.key, 'splitio-ga-to-split:mapper') === false)
    return false;

  if (data.trafficTypeName && validateTrafficType(data.trafficTypeName, 'splitio-ga-to-split:mapper') === false)
    return false;

  return true;
}

/**
 * GaToSplit integration.
 * This function provides the SplitTracker plugin to ga command queue.
 *
 * @param {object} sdkOptions options passed at the SDK integrations settings
 * @param {object} storage SDK storage passed to track events
 * @param {object} coreSettings core settings used to define an identity if no one provided as SDK or plugin options
 */
function GaToSplit(sdkOptions, storage, coreSettings) {

  const defaultOptions = {
    filter: defaultFilter,
    mapper: defaultMapper,
    prefix: defaultPrefix,
    // We set default identities if key and TT are present in settings.core
    identities: (coreSettings.key && coreSettings.trafficType) ?
      [{ key: coreSettings.key, trafficType: coreSettings.trafficType }] :
      undefined
  };

  class SplitTracker {

    // Constructor for the SplitTracker plugin.
    constructor(tracker, pluginOptions) {

      // precedence of options: SDK options (config.integrations) overwrite pluginOptions (`ga('require', 'splitTracker', pluginOptions)`)
      const opts = Object.assign({}, defaultOptions, sdkOptions, pluginOptions);

      this.tracker = tracker;

      // Validate identities
      const validIdentities = validateIdentities(opts.identities);

      if (!validIdentities || validIdentities.length === 0) {
        log.warn('No valid identities were provided. Please check that you are passing a valid list of identities or providing a traffic type at the SDK configuration.');
        return;
      }

      const invalids = validIdentities.length - opts.identities.length;
      if (invalids) {
        log.warn(`${invalids} identities were discarded because they are invalid or duplicated. Identities must be an array of objects with key and trafficType.`);
      }
      opts.identities = validIdentities;

      // Validate prefix
      // @TODO Improve the prefix validation using the same REGEX than eventTypeId
      if (!isString(opts.prefix)) {
        log.warn('The provided `prefix` was ignored since it is invalid. Please check that you are passing a string object as `prefix`.');
        opts.prefix = undefined;
      }

      // Overwrite sendHitTask to perform plugin tasks:
      // 1) filter hits
      // 2) map hits to Split events
      // 3) handle events, i.e., validate and send them to Split BE
      const originalSendHitTask = tracker.get('sendHitTask');
      tracker.set('sendHitTask', function (model) {
        originalSendHitTask(model);

        // filter and map hits into an EventData instance
        const eventData = opts.filter(model) && opts.mapper(model);

        // don't send the event if it is falsy or invalid when generated by a custom mapper
        if (!eventData || (opts.mapper !== defaultMapper && !validateEventData(eventData)))
          return;

        // Add prefix (with a falsy prefix, such as undefined or '', nothing is appended)
        if (opts.prefix) eventData.eventTypeId = `${opts.prefix}.${eventData.eventTypeId}`;

        // Add timestamp if not present
        if (!eventData.timestamp) eventData.timestamp = Date.now();

        // Store the event
        if (eventData.key && eventData.trafficTypeName) {
          storage.events.track(event);
        } else { // Store the event for each Key-TT pair (identities), if key and TT is not present in eventData
          opts.identities.forEach(identity => {
            const event = Object.assign({
              key: identity.key,
              trafficTypeName: identity.trafficType,
            }, eventData);
            storage.events.track(event);
          });
        }
      });
    }

  }

  // Register the plugin, even if config is invalid, since, if not provided, it will block `ga` command queue.
  providePlugin('splitTracker', SplitTracker);
}

export default GaToSplit;