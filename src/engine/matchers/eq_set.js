/**
Copyright 2016 Split Software

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
**/
'use strict';

/*eslint-disable eqeqeq */

const log = require('debug')('splitio-engine:matcher');
const _uniq = require('lodash/uniq');
const _isEqual = require('lodash/isEqual');

function equalToSetMatcherContext(vo /*: whitelistObject */) /*: Function */ {
  return function equalToSetMatcher(value /*: array */) /*: boolean */ {
    let normalizedValue = _uniq(value.map(e => e + '')); // Coerce values to string and remove duplicates
    let isEqual = _isEqual(normalizedValue, vo.whitelist);

    log(`[equalToSetMatcher] is ${normalizedValue} equal to set ${vo.whitelist}? ${isEqual}`);

    return isEqual;
  };
}

module.exports = equalToSetMatcherContext;