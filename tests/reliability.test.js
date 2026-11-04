const { test } = require('node:test')
const assert = require('node:assert/strict')
const code = require('../weather-cal-code.js')

function makeFileManager(files = {}) {
  const dates = {}
  return {
    files,
    libraryDirectory: () => '/library',
    joinPath: (a, b) => `${a}/${b}`,
    fileExists: path => Object.hasOwn(files, path),
    readString: path => files[path],
    writeString(path, value) { files[path] = value; dates[path] = new Date() },
    modificationDate: path => dates[path] || new Date(0),
  }
}

function makeCode(files = {}) {
  const instance = Object.create(code)
  instance.fm = makeFileManager(files)
  instance.data = {}
  instance.now = new Date('2026-11-03T15:00:00Z')
  instance.locale = 'en_US'
  instance.settings = { widget: { units: 'metric' }, weather: {} }
  return instance
}

function weather() {
  return {
    current: { temp: 17, dt: 1793718000, weather: [{ id: 800, main: 'Clear' }] },
    daily: Array.from({ length: 8 }, () => ({ sunrise: 1793690000, sunset: 1793730000, temp: { min: 10, max: 20 }, weather: [{ id: 800 }], pop: 0 })),
    hourly: Array.from({ length: 8 }, () => ({ temp: 17, weather: [{ id: 800 }], pop: 0 })),
  }
}

test('offline with no location or weather cache produces placeholders', async () => {
  const instance = makeCode({ '/library/weather-cal-api-key': 'existing-key' })
  global.Location = { current: async () => { throw Error('offline') } }
  global.Device = { locale: () => 'en_US' }
  global.Request = class { constructor() { throw Error('should not request without coordinates') } }
  await instance.setupWeather()
  assert.equal(instance.data.weather.currentTemp, null)
  assert.equal(instance.data.weather.currentCondition, 100)
  assert.equal(instance.data.location.latitude, null)
  assert.equal(await instance.isNight(), instance.now.getHours() < 6 || instance.now.getHours() >= 18)
})

test('failed refresh keeps valid cached weather and working 3.0 endpoint', async () => {
  const cached = weather()
  const instance = makeCode({
    '/library/weather-cal-location': JSON.stringify({ latitude: 37, longitude: -122, locality: 'Cupertino' }),
    '/library/weather-cal-cache': JSON.stringify(cached),
    '/library/weather-cal-api-key': 'existing-key',
  })
  global.Location = { current: async () => { throw Error('offline') } }
  global.Device = { locale: () => 'en_US' }
  let requestUrl
  global.Request = class { constructor(url) { requestUrl = url } async loadJSON() { throw Error('offline') } }
  await instance.setupWeather()
  assert.match(requestUrl, /data\/3\.0\/onecall/)
  assert.equal(instance.data.weather.currentTemp, 17)
  assert.equal(instance.fm.files['/library/weather-cal-cache'], JSON.stringify(cached))
  assert.equal(await instance.isNight(new Date(cached.current.dt * 1000)), false)
})

test('bad cache and API error never replace usable data', async () => {
  const instance = makeCode({
    '/library/weather-cal-location': '{bad',
    '/library/weather-cal-cache': '{bad',
    '/library/weather-cal-api-key': 'existing-key',
  })
  global.Location = { current: async () => ({ latitude: 37, longitude: -122 }), reverseGeocode: async () => [] }
  global.Device = { locale: () => 'en_US' }
  global.Request = class { async loadJSON() { return { cod: 401, message: 'error' } } }
  await instance.setupWeather()
  assert.equal(instance.data.weather.currentTemp, null)
  assert.equal(instance.fm.files['/library/weather-cal-cache'], '{bad')
})

test('real layout tokens still resolve to widget items', () => {
  for (const item of ['date', 'events', 'reminders', 'greeting', 'current']) {
    assert.equal(typeof code[item], 'function')
  }
})
