const assert = require("node:assert/strict")
const test = require("node:test")
const weatherCal = require("../weather-cal-code.js")

function makeWidget(files = {}) {
  const dates = Object.fromEntries(Object.keys(files).map(path => [path, new Date()]))
  const fm = {
    libraryDirectory: () => "/library",
    joinPath: (dir, name) => dir + "/" + name,
    fileExists: path => Object.hasOwn(files, path),
    readString: path => files[path],
    writeString: (path, value) => { files[path] = value; dates[path] = new Date() },
    modificationDate: path => dates[path] || new Date(0),
  }
  const widget = Object.create(weatherCal)
  widget.fm = fm
  widget.now = new Date()
  widget.locale = "en_US"
  widget.settings = { widget: { units: "imperial" }, weather: { locale: "" } }
  widget.data = { location: { latitude: 40, longitude: -74 } }
  return { widget, files, dates }
}

const forecast = {
  current: { temp: 70, weather: [{ id: 800, main: "Clear", description: "clear sky" }] },
  daily: Array.from({ length: 8 }, () => ({ temp: { max: 75, min: 60 }, weather: [{ id: 800 }], pop: 0.3, sunrise: 1762178400, sunset: 1762218000 })),
  hourly: Array.from({ length: 8 }, () => ({ temp: 70, weather: [{ id: 800 }], pop: 0.2 })),
}

test("existing API key and saved path are reused without probing another endpoint", async () => {
  const { widget, files } = makeWidget({
    "/library/weather-cal-api-key": "existing-key",
    "/library/weather-cal-api-path": "https://api.openweathermap.org/data/3.0/onecall",
  })
  let requests = 0
  global.Device = { locale: () => "en_US" }
  global.Request = class {
    constructor(url) {
      assert.match(url, /\/data\/3\.0\/onecall\?appid=existing-key&lat=40&lon=-74/)
      requests++
    }
    async loadJSON() { return forecast }
  }
  await widget.setupWeather()
  assert.equal(requests, 1)
  assert.equal(widget.data.weather.currentTemp, 70)
  assert.equal(files["/library/weather-cal-api-path"], "https://api.openweathermap.org/data/3.0/onecall")
})

test("API detection saves the endpoint accepted by a new key", async () => {
  const { widget, files } = makeWidget()
  global.Request = class {
    constructor(url) { this.url = url }
    async loadJSON() { return this.url.includes("/3.0/") ? { cod: 401 } : forecast }
  }
  const result = await widget.getWeatherApiPath("new-key")
  assert.equal(result, forecast)
  assert.equal(files["/library/weather-cal-api-path"], "https://api.openweathermap.org/data/2.5/onecall")
})

test("COVID item and preferences are removed", async () => {
  const { widget } = makeWidget()
  const settings = await widget.defaultSettings()
  for (const item of ["date", "sunset", "battery", "events", "current", "future"]) {
    assert.equal(typeof weatherCal[item], "function", `${item} remains available to the widget layout`)
  }
  assert.equal("covid" in weatherCal, false)
  assert.equal("setupCovid" in weatherCal, false)
  assert.equal("covid" in settings, false)
  assert.equal("covid" in settings.localization, false)
  assert.equal("covid" in settings.font, false)
})

test("offline refresh without cached location or weather uses placeholders", async () => {
  const { widget } = makeWidget({ "/library/weather-cal-api-key": "existing-key" })
  widget.data = {}
  widget.settings.widget.updateLocation = "60"
  global.Device = { locale: () => "en_US" }
  global.Location = { current: async () => { throw new Error("offline") } }
  global.Request = class { constructor() { throw new Error("should not request without coordinates") } }

  await widget.setupWeather()
  await widget.setupSunrise()
  assert.equal(widget.data.location.locality, "--")
  assert.equal(widget.data.weather.currentTemp, null)
  assert.equal(widget.data.sun.sunrise, null)
})

test("offline refresh keeps a valid cached forecast for up to six hours", async () => {
  const { widget, files, dates } = makeWidget({
    "/library/weather-cal-api-key": "existing-key",
    "/library/weather-cal-api-path": "https://api.openweathermap.org/data/3.0/onecall",
    "/library/weather-cal-cache": JSON.stringify(forecast),
  })
  dates["/library/weather-cal-cache"] = new Date(widget.now.getTime() - 2 * 60 * 60 * 1000)
  global.Device = { locale: () => "en_US" }
  global.Request = class { async loadJSON() { throw new Error("offline") } }

  await widget.setupWeather()
  assert.equal(widget.data.weather.currentTemp, 70)
  assert.equal(JSON.parse(files["/library/weather-cal-cache"]).current.temp, 70)
})

test("API error does not replace a usable cached forecast", async () => {
  const { widget, files, dates } = makeWidget({
    "/library/weather-cal-api-key": "existing-key",
    "/library/weather-cal-api-path": "https://api.openweathermap.org/data/3.0/onecall",
    "/library/weather-cal-cache": JSON.stringify(forecast),
  })
  dates["/library/weather-cal-cache"] = new Date(widget.now.getTime() - 2 * 60 * 60 * 1000)
  global.Device = { locale: () => "en_US" }
  global.Request = class { async loadJSON() { return { cod: 401 } } }

  await widget.setupWeather()
  assert.equal(widget.data.weather.currentTemp, 70)
  assert.equal(JSON.parse(files["/library/weather-cal-cache"]).current.temp, 70)
})

test("corrupt cache is ignored safely", async () => {
  const { widget } = makeWidget({ "/library/weather-cal-cache": "invalid json" })
  assert.equal(widget.getCache("/library/weather-cal-cache", 1, 360), null)
})

test("malformed weather response without cache uses placeholders", async () => {
  const { widget } = makeWidget({
    "/library/weather-cal-api-key": "existing-key",
    "/library/weather-cal-api-path": "https://api.openweathermap.org/data/3.0/onecall",
  })
  global.Device = { locale: () => "en_US" }
  global.Request = class { async loadJSON() { return { current: {}, daily: [] } } }
  await widget.setupWeather()
  assert.equal(widget.data.weather.currentTemp, null)
  assert.equal(widget.data.weather.forecast[1].Condition, 100)
})
