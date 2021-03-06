// Copyright (c) Microsoft Corporation and others. Licensed under the MIT license.
// SPDX-License-Identifier: MIT

const BaseHandler = require('../../lib/baseHandler')
const requestRetry = require('requestretry').defaults({ maxAttempts: 3, fullResponse: true })
const nodeRequest = require('request')
const fs = require('fs')
const { findLastKey, get, find } = require('lodash')

const providerMap = {
  pypi: 'https://pypi.python.org'
}
class PyPiFetch extends BaseHandler {
  canHandle(request) {
    const spec = this.toSpec(request)
    return spec && spec.provider === 'pypi'
  }

  async handle(request) {
    const spec = this.toSpec(request)
    const registryData = await this._getRegistryData(spec)
    spec.revision = spec.revision ? spec.revision : this._getRevision(registryData)
    request.url = spec.toUrl()
    const file = this._createTempFile(request)
    await this._getPackage(spec, registryData, file.name)
    const dir = this._createTempDir(request)
    await this.decompress(file.name, dir.name)
    request.document = await this._createDocument(dir, spec, registryData)
    request.contentOrigin = 'origin'
    return request
  }

  async _getRegistryData(spec) {
    const baseUrl = providerMap.pypi
    const { body, statusCode } = await requestRetry.get(`${baseUrl}/pypi/${spec.name}/json`, {
      json: true
    })
    if (statusCode !== 200 || !body) return null
    return body
  }

  _getRevision(registryData) {
    if (!registryData || !registryData.releases) return null
    return findLastKey(registryData.releases)
  }

  _createDocument(dir, spec, registryData) {
    const releaseDate = this._extractReleaseDate(spec, registryData)
    return { location: dir.name, registryData, releaseDate }
  }

  _extractReleaseDate(spec, registryData) {
    const releaseTypes = get(registryData, ['releases', spec.revision])
    const release = find(releaseTypes, entry => {
      return entry.url && entry.url.length > 6 && entry.url.slice(-6) === 'tar.gz'
    })
    if (!release) return
    return release.upload_time
  }

  async _getPackage(spec, registryData, destination) {
    const releaseTypes = get(registryData, ['releases', spec.revision])
    const release = find(releaseTypes, entry => {
      return entry.url && entry.url.length > 6 && entry.url.slice(-6) === 'tar.gz'
    })
    if (!release) return
    return new Promise((resolve, reject) => {
      nodeRequest
        .get(release.url, (error, response) => {
          if (error) return reject(error)
          if (response.statusCode !== 200) reject(new Error(`${response.statusCode} ${response.statusMessage}`))
        })
        .pipe(fs.createWriteStream(destination).on('finish', () => resolve(null)))
    })
  }
}

module.exports = options => new PyPiFetch(options)
