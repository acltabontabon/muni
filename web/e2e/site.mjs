/**
 * The original marketing site's reflected hero, scroll story and five-step retro walkthrough.
 * No backend or account is required. Start its static server separately:
 *
 *   python3 -m http.server 4322 --bind 127.0.0.1 --directory site
 *   cd web && SITE_URL=http://localhost:4322 node e2e/site.mjs
 *
 * SHOTS=dir optionally saves the hero at 1440×1000 and 390×900. Nothing is published.
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
const watchErrors = (page) => page.on('pageerror', (error) => errors.push(error.message))
const ready = async (page) => {
  await page.goto(BASE)
  await page.evaluate(() => document.fonts.ready)
}
const scrollScene = async (page, progress) => {
  await page.evaluate((p) => {
    const scene = document.querySelector('.scene')
    const top = scrollY + scene.getBoundingClientRect().top
    scrollTo({ top: top + p * (scene.offsetHeight - innerHeight), behavior: 'instant' })
  }, progress)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}
const showDuo = async (page) => {
  await page.evaluate(() => {
    const duo = document.querySelector('.duo')
    const top = scrollY + duo.getBoundingClientRect().top
    scrollTo({ top: top + duo.offsetHeight / 2 - innerHeight / 2, behavior: 'instant' })
  })
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  watchErrors(page)
  await ready(page)
  const headline = (await page.locator('.hero h1').textContent()).replace(/\s+/g, ' ').trim()
  check('The original reflected hero introduces Muni', headline === 'Good retros start before the meeting.')
  check('The headline has its water reflection', (await page.locator('.hero .reflection .mirrored').textContent()).replace(/\s+/g, ' ').trim() === headline && (await page.locator('.hero .reflection').getAttribute('aria-hidden')) === 'true')
  check('The browser description explains capture, reflection and action', (await page.locator('meta[name=description]').getAttribute('content')) === 'Capture thoughts throughout the sprint. Reflect together. Turn insights into action.')
  check('Every app link opens the configured app', await page.locator('.app-link').evaluateAll((links) => links.length > 0 && links.every((link) => link.href === new URL(document.documentElement.dataset.appUrl).href)))
  check('Every section link points to a real section', await page.locator('a[href^="#"]').evaluateAll((links) => links.every((link) => document.getElementById(link.getAttribute('href').slice(1)))))
  await shot(page, 'site-desktop')

  // Reduced motion holds decorative scenes still without removing the story.
  await page.waitForTimeout(1200)
  check('Reduced motion adds no falling hero thoughts', (await page.locator('.hero .drop').count()) === 0)
  check('Reduced motion shows the phone, problem and guide final states', await page.locator('.woe, .phone, .evening-art').evaluateAll((scenes) => scenes.length > 0 && scenes.every((scene) => scene.classList.contains('in') && scene.classList.contains('still'))))
  const sceneSteps = [
    [0.12, 0, /Day \d+ of 10/, 'day'],
    [0.36, 1, /sealed until collection closes/, 'day'],
    [0.57, 2, /one batch, random order/, 'dusk'],
    [0.86, 3, /5 themes \+ everything else/, 'night'],
  ]
  for (const [progress, step, status, sky] of sceneSteps) {
    await scrollScene(page, progress)
    check(`Scrolling reaches capture story step ${step + 1}`, (await page.locator('.caption.on').getAttribute('data-step')) === String(step))
    check(`Capture story step ${step + 1} explains its state`, status.test(await page.locator('.field-status-text').textContent()))
    check(`Capture story step ${step + 1} keeps its original sky`, (await page.locator('html').getAttribute('data-sky')) === sky)
  }
  check('The reveal removes author badges from the illustration', await page.locator('.field .note .who').evaluateAll((badges) => badges.every((badge) => parseFloat(getComputedStyle(badge).opacity) === 0)))
  check('The theme illustration includes everything left ungrouped', (await page.locator('.field .tile.on').count()) === 6 && (await page.locator('.field .tile.ungrouped b').textContent()) === 'Everything else')

  await page.locator('#duo-t1').click()
  check('The selected retro panel alone is visible', await page.locator('.duo-panel').evaluateAll((panels) => panels.filter((panel) => !panel.hidden).length === 1))
  await page.locator('#duo-t1').press('ArrowRight')
  check('Right arrow selects the next retro step', (await selected(page, 'duo-t2')) === 'true')
  check('Keyboard navigation moves focus with selection', await page.locator('#duo-t2').evaluate((tab) => tab === document.activeElement))
  await page.locator('#duo-t2').press('End')
  check('End selects the recap', (await selected(page, 'duo-t5')) === 'true' && await page.locator('#duo-p5').isVisible())
  await page.locator('#duo-t5').press('ArrowRight')
  check('Right arrow wraps to Look back', (await selected(page, 'duo-t1')) === 'true')
  await page.locator('#duo-t1').press('ArrowLeft')
  check('Left arrow wraps to the recap', (await selected(page, 'duo-t5')) === 'true')
  await page.locator('#duo-t5').press('Home')
  check('Home returns to Look back', (await selected(page, 'duo-t1')) === 'true')
  check('Retro tabs expose only one tab stop', await page.locator('.duo-tabs [role=tab]').evaluateAll((tabs) => tabs.filter((tab) => tab.tabIndex === 0).length === 1))
  check('Each retro tab names its own panel', await page.locator('.duo-tabs [role=tab]').evaluateAll((tabs) => tabs.every((tab) => document.getElementById(tab.getAttribute('aria-controls'))?.getAttribute('aria-labelledby') === tab.id)))
  await page.locator('#duo-t4').click()
  await page.waitForFunction(() => document.getElementById('duo-p4').classList.contains('owned'))
  check('Reduced motion immediately shows the experiment owner accepting', await page.locator('#duo-p4 .ds-owner .yes').isVisible())
  check('Reduced motion does not autoplay the retro', !(await page.locator('.duo').evaluate((duo) => duo.hasAttribute('data-playing'))))
  await page.locator('.stage').scrollIntoViewIfNeeded()
  check('Reduced motion removes the stage tilt', (await page.locator('.stage').evaluate((stage) => getComputedStyle(stage).transform)) === 'none')
  await page.locator('.experiment').scrollIntoViewIfNeeded()
  await page.waitForFunction(() => document.querySelector('.experiment').classList.contains('in'))
  check('Reduced motion presents the experiment without typing it out', await page.locator('.typed').evaluate((typed) => typed.textContent === typed.dataset.text))

  // Different panels use different layouts; preserve all of them across phone and desktop widths.
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await ready(page)
    check(`The original page fits ${width}px`, !(await overflow(page)))
    check(`The app remains reachable at ${width}px`, await page.locator('.nav .app-link').isVisible())
    for (const n of [1, 2, 3, 4, 5]) {
      await page.locator(`#duo-t${n}`).click()
      check(`Retro step ${n} fits ${width}px`, !(await overflow(page)))
      check(`Retro step ${n} retains stage and phone at ${width}px`, await page.locator(`#duo-p${n} .ds`).isVisible() && await page.locator(`#duo-p${n} .dp`).isVisible())
    }
    await scrollScene(page, 0.86)
    check(`The scroll story fits ${width}px`, !(await overflow(page)))
    check(`All theme tiles fit their illustration at ${width}px`, await page.locator('.field').evaluate((field) => {
      const box = field.getBoundingClientRect()
      return [...field.querySelectorAll('.tile')].every((tile) => {
        const bounds = tile.getBoundingClientRect()
        return bounds.left >= box.left - 1 && bounds.right <= box.right + 1
      })
    }))
    if (width === 390) {
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
      await page.waitForFunction(() => document.documentElement.dataset.sky === 'day')
      await page.waitForTimeout(1000)
      await shot(page, 'site-phone')
    }
  }
  await context.close()

  // The original walkthrough automatically plays once while visible; hover, focus and clicks
  // give the reader control. These checks use the real seven-second pace.
  const motionContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' })
  const motion = await motionContext.newPage()
  watchErrors(motion)
  await ready(motion)
  await motion.waitForFunction(() => document.querySelector('.hero .drop'))
  check('The original hero drops thoughts onto its water', (await motion.locator('.hero .drop').count()) > 0)
  await motion.locator('.nav .brand').hover()
  await showDuo(motion)
  await motion.waitForFunction(() => document.querySelector('.duo').hasAttribute('data-playing'))
  check('The original retro plays while in view', await motion.locator('.duo').evaluate((duo) => duo.hasAttribute('data-playing')))
  await motion.waitForFunction(() => document.getElementById('duo-t2').getAttribute('aria-selected') === 'true', null, { timeout: 10000 })
  check('Autoplay advances from Look back to Choose', (await selected(motion, 'duo-t2')) === 'true')
  await motion.locator('#duo-t2').hover()
  check('Hover pauses the original walkthrough', !(await motion.locator('.duo').evaluate((duo) => duo.hasAttribute('data-playing'))))
  await motion.waitForTimeout(7300)
  check('A hovered step stays available to read', (await selected(motion, 'duo-t2')) === 'true')
  await motion.locator('.nav .brand').hover()
  await motion.waitForFunction(() => document.querySelector('.duo').hasAttribute('data-playing'))
  check('Leaving the walkthrough resumes its original playback', await motion.locator('.duo').evaluate((duo) => duo.hasAttribute('data-playing')))
  await motion.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
  await motion.waitForFunction(() => !document.querySelector('.duo').hasAttribute('data-playing'))
  check('The original walkthrough pauses outside the viewport', !(await motion.locator('.duo').evaluate((duo) => duo.hasAttribute('data-playing'))))
  await showDuo(motion)
  await motion.locator('#duo-t3').click()
  check('Choosing a tab hands control to the reader', (await selected(motion, 'duo-t3')) === 'true' && !(await motion.locator('.duo').evaluate((duo) => duo.hasAttribute('data-playing'))))
  await motion.locator('#duo-t5').click()
  check('The original recap remains available at the end', await motion.locator('#duo-p5').isVisible() && !(await motion.locator('.duo').evaluate((duo) => duo.hasAttribute('data-playing'))))
  await motionContext.close()

  const noJSContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 900 } })
  const noJS = await noJSContext.newPage()
  await noJS.goto(BASE)
  check('Without JavaScript, the original headline remains readable', await noJS.locator('.hero h1').isVisible())
  check('Without JavaScript, all capture explanations remain readable', await noJS.locator('.caption').evaluateAll((panels) => panels.every((panel) => getComputedStyle(panel).display !== 'none')))
  check('Without JavaScript, the first retro panel remains readable', await noJS.locator('#duo-p1').isVisible())
  check('Without JavaScript, the phone page still fits', !(await overflow(noJS)))
  check('Without JavaScript, the app link still works', (await noJS.locator('.nav .app-link').getAttribute('href')) === 'https://act.munimuni.app')
  await noJSContext.close()
  check('The restored site reports no JavaScript errors', errors.length === 0, errors.join(', '))
} finally {
  await browser.close()
}

const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} marketing checks passed.`)
if (failed.length) process.exitCode = 1
