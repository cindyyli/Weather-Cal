const { test } = require('node:test')
const assert = require('node:assert/strict')
const code = require('../weather-cal-code.js')

class Stack {
  constructor(parent = null) { this.parent = parent; this.children = [] }
  addStack() { const child = new Stack(this); this.children.push(child); return child }
  addText(text) { const child = { text, parent: this }; this.children.push(child); return child }
  addSpacer() {}
  setPadding() {}
  layoutHorizontally() {}
  layoutVertically() {}
}

function tapTargets(stack) {
  const targets = []
  for (const child of stack.children) {
    if (child.children) targets.push(...tapTargets(child))
    else {
      let ancestor = child
      while (ancestor && !ancestor.url) ancestor = ancestor.parent
      targets.push({ text: child.text, url: ancestor && ancestor.url })
    }
  }
  return targets
}

function fixture() {
  const instance = Object.create(code)
  instance.fm = { fileExists: () => false }
  instance.settings = instance.getSettings()
  instance.format = instance.settings.font
  instance.localization = instance.settings.localization
  instance.padding = 4
  instance.now = new Date('2026-11-03T12:00:00Z')
  instance.left()
  instance.provideText = (text, stack) => stack.addText(text)
  instance.formatTime = date => date.toISOString()
  instance.formatDate = () => 'NOV 4'
  instance.settings.events.showCalendarColor = 'none'
  instance.settings.events.showLocation = true
  instance.settings.events.showEventLength = ''
  instance.settings.reminders.showListColor = 'none'
  instance.settings.reminders.useRelativeDueDate = true
  global.RelativeDateTimeFormatter = class {
    useNamedDateTimeStyle() {}
    string(date) { return date.toISOString() }
  }
  return instance
}

test('each event title, location and time has its own link, including future and all-day events', async () => {
  const instance = fixture()
  const events = [
    { identifier: 'calendar-a:event-a', title: 'Meeting A', location: 'Room A', startDate: new Date('2026-11-03T14:00:00Z') },
    { identifier: 'calendar-b:event-b', title: 'Meeting B', location: 'Room B', startDate: new Date('2026-11-04T14:00:00Z'), isAllDay: true },
  ]
  instance.data = { events: { futureEvents: events } }
  const column = new Stack()
  await instance.events(column)
  const targets = tapTargets(column)
  for (const event of events) {
    const expected = instance.eventLink(event)
    assert.equal(targets.find(item => item.text == event.title).url, expected)
    assert.equal(targets.find(item => item.text == event.location).url, expected)
    if (!event.isAllDay) assert.equal(targets.find(item => item.text == event.startDate.toISOString()).url, expected)
  }
  assert.match(targets.find(item => item.text == 'TOMORROW').url, /^calshow:/)
})

test('each reminder title and due time links to its own reminder, including undated reminders', async () => {
  const instance = fixture()
  const reminders = [
    { identifier: 'reminder-a', title: 'Task A', dueDate: new Date('2026-11-04T14:00:00Z') },
    { identifier: 'reminder-b', title: 'Task B' },
  ]
  instance.data = { reminders: { all: reminders } }
  const column = new Stack()
  await instance.reminders(column)
  const targets = tapTargets(column)
  assert.equal(targets.find(item => item.text == 'Task A').url, 'x-apple-reminderkit://REMCDReminder/reminder-a/details')
  assert.equal(targets.find(item => item.text == reminders[0].dueDate.toISOString()).url, instance.reminderLink(reminders[0]))
  assert.equal(targets.find(item => item.text == 'Task B').url, 'x-apple-reminderkit://REMCDReminder/reminder-b/details')
})

test('missing or unsupported event IDs fall back to the event date; reminder IDs fall back to the app', () => {
  const event = { startDate: new Date('2001-01-02T00:00:00Z') }
  for (const identifier of [undefined, '', 'single-id', ':event-id', 'cal:']) {
    assert.equal(code.eventLink({ ...event, identifier }), 'calshow:86400')
  }
  assert.equal(code.reminderLink({}), 'x-apple-reminderkit://')
  assert.equal(code.eventLink({ identifier: 'calendar:event/with?characters' }), 'x-apple-calevent://calendar/event%2Fwith%3Fcharacters')
})

test('custom event and reminder destination preferences still override item links', async () => {
  const instance = fixture()
  instance.settings.events.url = 'custom-calendar://'
  instance.settings.reminders.url = 'custom-reminders://'
  instance.data = {
    events: { futureEvents: [{ title: 'Meeting', identifier: 'cal:event', startDate: instance.now, isAllDay: true }] },
    reminders: { all: [{ title: 'Task', identifier: 'task-id' }] },
  }
  const column = new Stack()
  await instance.events(column)
  await instance.reminders(column)
  const targets = tapTargets(column)
  assert.equal(targets.find(item => item.text == 'Meeting').url, 'custom-calendar://')
  assert.equal(targets.find(item => item.text == 'Task').url, 'custom-reminders://')
})
