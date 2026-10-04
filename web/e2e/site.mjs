/**
 * Marketing site previews, keyboard use, responsive layouts and no-JavaScript fallback.
 * No backend or account is required. Start the static site server separately:
 *
 *   python3 -m http.server 4322 --bind 127.0.0.1 --directory site
 *   cd web && SITE_URL=http://localhost:4322 node e2e/site.mjs
 *
 * SHOTS=dir optionally saves desktop and phone screenshots. Nothing is published.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.SITE_URL ?? 'http://localhost:4322'
const SHOTS = process.env.SHOTS ?? null
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` })
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
const selected = (page, id) => page.locator(`#${id}`).getAttribute('aria-selected')
const browser = await chromium.launch({ channel: 'chromium' })
const errors = []

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  const submissions = []
  page.on('request', (request) => {
    if (['fetch', 'xhr'].includes(request.resourceType()) || request.method() !== 'GET') submissions.push(request.url())
  })
  await page.goto(BASE)
  await page.evaluate(() => document.fonts.ready)
  check('Sample form enables only after handlers are ready', await page.locator('#sample-fields').isEnabled())
  await shot(page, 'site-desktop')

  // Sample text is deliberately HTML-shaped: it must remain plain text through save and reveal.
  const sample = 'A little <b>thought</b> & a specific moment.'
  await page.locator('#sample-thought').fill(sample)
  await page.getByRole('radio', { name: 'Improve', exact: true }).check()
  await page.getByRole('button', { name: 'Try saving' }).click()
  check('Saving shows the thought exactly as written', (await page.locator('#saved-text').textContent()) === sample)
  check('Sample text cannot create HTML elements', (await page.locator('#saved-text b').count()) === 0)
  check('The selected category follows the thought', (await page.locator('#saved-category').textContent()) === 'Improve')
  check('Saving focuses the result heading', await page.locator('#sample-saved h2').evaluate((el) => el === document.activeElement))
  check('The result still identifies itself as a sample', (await page.locator('#sample-status').textContent()).includes('nothing sent or stored'))
  await page.getByRole('button', { name: 'Preview the reveal' }).click()
  check('Reveal shows the shared representation', await page.locator('#sample-saved').evaluate((el) => el.classList.contains('is-revealed')))
  check('Reveal explains the missing author information', (await page.locator('#saved-explainer').textContent()).includes('Names, writing times and author links'))
  await page.getByRole('button', { name: 'Edit thought', exact: true }).click()
  check('Editing restores the original thought', (await page.locator('#sample-thought').inputValue()) === sample)
  check('Editing returns focus to the input', await page.locator('#sample-thought').evaluate((el) => el === document.activeElement))
  await page.locator('#sample-thought').fill('   ')
  await page.getByRole('button', { name: 'Try saving' }).click()
  check('Whitespace cannot become a sample thought', !(await page.locator('#sample-thought').evaluate((el) => el.checkValidity())))
  await page.locator('#sample-thought').fill('Pairing helped us fix the tricky bug.')
  check('Writing again clears the validation error', await page.locator('#sample-thought').evaluate((el) => el.checkValidity()))
  check('Trying the sample submits no request', submissions.length === 0, submissions.join(', '))
  check('Trying the sample changes neither the URL nor browser storage', (await page.url()) === new URL(BASE).href && await page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0))

  await page.locator('#capture-t1').click()
  await page.locator('#capture-t1').press('End')
  check('End selects the last capture step', (await selected(page, 'capture-t4')) === 'true')
  check('The selected capture explanation becomes visible', await page.locator('#capture-p4').isVisible())
  await page.locator('#capture-t4').press('ArrowRight')
  check('Right arrow wraps the capture steps', (await selected(page, 'capture-t1')) === 'true')
  await page.locator('#capture-t1').press('ArrowLeft')
  check('Left arrow wraps the capture steps', (await selected(page, 'capture-t4')) === 'true')
  await page.locator('#capture-t4').press('Home')
  check('Home selects the first capture step', (await selected(page, 'capture-t1')) === 'true')
  check('Capture tabs expose only one tab stop', await page.locator('.capture-steps [role=tab]').evaluateAll((tabs) => tabs.filter((tab) => tab.tabIndex === 0).length === 1))

  await page.locator('#duo-t1').click()
  await page.waitForTimeout(7500)
  check('The walkthrough waits for the reader to start it', (await selected(page, 'duo-t1')) === 'true')
  await page.locator('#duo-t1').press('ArrowRight')
  check('Right arrow selects the next retro step', (await selected(page, 'duo-t2')) === 'true')
  await page.locator('#duo-t2').press('End')
  check('End selects the recap', (await selected(page, 'duo-t5')) === 'true' && await page.locator('#duo-p5').isVisible())
  await page.getByRole('button', { name: 'Replay walkthrough' }).click()
  check('Replay returns to the first retro step', (await selected(page, 'duo-t1')) === 'true')
  await page.getByRole('button', { name: 'Pause walkthrough' }).click()
  check('The reader can pause playback', (await page.locator('#duo-play').getAttribute('aria-pressed')) === 'false')
  await page.getByRole('button', { name: 'Play walkthrough' }).click()
  await page.waitForFunction(() => document.getElementById('duo-t2').getAttribute('aria-selected') === 'true', null, { timeout: 10000 })
  check('Requested playback advances to the next step', (await selected(page, 'duo-t2')) === 'true')
  await page.locator('#questions').scrollIntoViewIfNeeded()
  await page.waitForFunction(() => !document.querySelector('.duo').hasAttribute('data-playing'))
  check('Playback pauses outside the visible page', !(await page.locator('.duo').evaluate((el) => el.hasAttribute('data-playing'))))
  await page.locator('#duo-play').scrollIntoViewIfNeeded()
  await page.waitForFunction(() => document.querySelector('.duo').hasAttribute('data-playing'))
  check('Requested playback resumes on return', await page.locator('.duo').evaluate((el) => el.hasAttribute('data-playing')))
  await page.locator('#duo-t3').click()
  check('Choosing a tab stops playback', (await page.locator('#duo-play').getAttribute('aria-pressed')) === 'false')
  check('Retro tabs expose only one tab stop', await page.locator('.duo-tabs [role=tab]').evaluateAll((tabs) => tabs.filter((tab) => tab.tabIndex === 0).length === 1))

  const question = page.locator('.faq-list summary').filter({ hasText: 'How do we start?' })
  await question.focus()
  await question.press('Enter')
  check('The newcomer FAQ opens from the keyboard', (await page.locator('.faq-list details').nth(1).getAttribute('open')) === '')
  await question.press('Enter')
  check('The newcomer FAQ closes from the keyboard', (await page.locator('.faq-list details').nth(1).getAttribute('open')) === null)
  await page.locator('.stage').scrollIntoViewIfNeeded()
  await page.waitForTimeout(1200)
  check('Reduced motion keeps the sample stage clock still', (await page.locator('[data-timer]').textContent()) === '12:40')

  // Every retro panel has a different layout; check all of them at each width.
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(BASE)
    await page.evaluate(() => document.fonts.ready)
    check(`The page fits ${width}px`, !(await overflow(page)))
    for (const n of [1, 2, 3, 4, 5]) {
      await page.locator(`#duo-t${n}`).click()
      check(`Retro step ${n} fits ${width}px`, !(await overflow(page)))
    }
    if (width < 761) {
      await page.evaluate(() => scrollTo(0, 0))
      await page.getByRole('button', { name: 'Menu', exact: true }).click()
      check(`Menu opens at ${width}px`, await page.locator('#site-navigation').isVisible())
      await page.keyboard.press('Escape')
      check(`Escape closes Menu at ${width}px and returns focus`, !(await page.locator('#site-navigation').isVisible()) && await page.locator('.nav-toggle').evaluate((el) => el === document.activeElement))
      await page.getByRole('button', { name: 'Menu', exact: true }).click()
      await page.locator('#site-navigation').getByRole('link', { name: 'How it works' }).click()
      check(`Choosing a section closes Menu at ${width}px`, !(await page.locator('#site-navigation').isVisible()))
    }
    if (width === 390) {
      await page.evaluate(() => scrollTo(0, 0))
      await shot(page, 'site-phone')
    }
  }
  check('The interactive page reports no JavaScript errors', errors.length === 0, errors.join(', '))
  await context.close()

  // An absent script must never fall through to native GET submission of a thought.
  const brokenContext = await browser.newContext()
  const brokenPage = await brokenContext.newPage()
  await brokenPage.route('**/main.js*', (route) => route.abort())
  await brokenPage.goto(BASE)
  check('A missing script leaves the preview form disabled', await brokenPage.getByRole('button', { name: 'Try saving' }).isDisabled())
  await brokenContext.close()

  const noJSContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } })
  const noJS = await noJSContext.newPage()
  await noJS.goto(BASE)
  check('Without JavaScript, sample saving stays disabled', await noJS.getByRole('button', { name: 'Try saving' }).isDisabled())
  check('Without JavaScript, mobile navigation remains visible', await noJS.locator('#site-navigation').isVisible())
  check('Without JavaScript, every capture explanation is readable', await noJS.locator('.caption').evaluateAll((panels) => panels.every((panel) => getComputedStyle(panel).display !== 'none')))
  check('Without JavaScript, every retro explanation is readable', await noJS.locator('.duo-panel').evaluateAll((panels) => panels.every((panel) => getComputedStyle(panel).display !== 'none')))
  check('Without JavaScript, the phone page still fits', !(await overflow(noJS)))
  check('Without JavaScript, the app link still works', (await noJS.locator('.nav .app-link').getAttribute('href')) === 'https://act.munimuni.app')
  await noJS.locator('.faq-list summary').filter({ hasText: 'How do we start?' }).click()
  check('Without JavaScript, the FAQ still opens', (await noJS.locator('.faq-list details').nth(1).getAttribute('open')) === '')
  await noJSContext.close()
} finally {
  await browser.close()
}

const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} marketing checks passed.`)
if (failed.length) process.exitCode = 1
