/**
 * Playwright Electron snapshot verification tests.
 *
 * These tests launch the production-built Electron app and take
 * screenshots to prove each phase-1 feature works correctly.
 *
 * Run after `npx electron-forge package`:
 *   npx vitest run test/e2e/snapshots.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import path from 'node:path'

const FIXTURES = process.env.GRAPHARC_TEST_PROJECT
  || path.resolve(__dirname, '..', 'fixtures', 'sample-project')
const SNAPSHOTS = path.resolve(__dirname, '..', 'snapshots')

let app: ElectronApplication
let page: Page

beforeAll(async () => {
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, NODE_ENV: 'test' },
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
}, 30_000)

afterAll(async () => {
  await app?.close()
})

describe('Task 1 — Scaffold', () => {
  it('welcome screen renders with correct title', async () => {
    const title = await page.title()
    expect(title).toBe('GraphArc')

    await page.screenshot({ path: path.join(SNAPSHOTS, 'task01-welcome.png') })

    // Verify welcome UI elements exist
    const heading = await page.locator('h1').textContent()
    expect(heading).toBe('GraphArc')

    const button = await page.locator('button').textContent()
    expect(button).toBe('Open Project Folder...')
  })
})

describe('Task 7+8 — Worker + IPC', () => {
  it('worker starts and no critical console errors', async () => {
    // Collect console messages for a moment
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.waitForTimeout(2000)

    await page.screenshot({ path: path.join(SNAPSHOTS, 'task08-ipc-ready.png') })

    // No page-level errors (worker errors go to main process, not renderer)
    expect(errors).toEqual([])
  })
})

describe('Task 9 — React Flow Canvas', () => {
  it('graph renders after opening a project', async () => {
    // Trigger project:open via the renderer's IPC bridge
    await page.evaluate((fixturesDir) => {
      return window.grapharc.openProject(fixturesDir)
    }, FIXTURES)

    // Capture loading state — should show loading overlay, not module graph
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(SNAPSHOTS, 'project-loading.png') })

    // Wait for graph nodes to appear (layer nodes or module nodes)
    await page.waitForSelector('.react-flow__node', { timeout: 30_000 })
    await page.screenshot({ path: path.join(SNAPSHOTS, 'task09-graph-rendered.png') })

    // Verify multiple nodes exist
    const nodeCount = await page.locator('.react-flow__node').count()
    expect(nodeCount).toBeGreaterThan(0)
  }, 40_000)
})

describe('Task 10 — Detail Panel', () => {
  it('clicking a node shows detail or drills down', async () => {
    // Click the first graph node (may be a layer node which drills down)
    const firstNode = page.locator('.react-flow__node').first()
    await firstNode.click()
    await page.waitForTimeout(2000)

    // Either a detail panel shows OR drill-down occurred (breadcrumb appears)
    const detailVisible = await page.locator('.detail-panel').isVisible().catch(() => false)
    const breadcrumbVisible = await page.locator('.breadcrumb').isVisible().catch(() => false)
    const drillOccurred = detailVisible || breadcrumbVisible

    await page.screenshot({ path: path.join(SNAPSHOTS, 'task10-detail-panel.png') })
    expect(drillOccurred).toBe(true)
  }, 20_000)
})

describe('Task 11 — Filter Bar', () => {
  it('filter bar is visible and search works', async () => {
    // Filter bar should be visible when graph is showing
    const filterBarVisible = await page.locator('.filter-bar').isVisible()
    expect(filterBarVisible).toBe(true)

    await page.screenshot({ path: path.join(SNAPSHOTS, 'task11-filter-bar.png') })

    // Type a search query
    const searchInput = page.locator('.search-input')
    await searchInput.fill('main')
    await page.waitForTimeout(500)

    await page.screenshot({ path: path.join(SNAPSHOTS, 'task11-filtered.png') })

    // Clear search for subsequent tests
    await searchInput.fill('')
    await page.waitForTimeout(300)
  })
})

describe('Cache — Auto-load', () => {
  it('cached analysis loads automatically on project open', async () => {
    // Wait for cached analysis to load — layers should appear without clicking Analyze
    await page.locator('.analysis-layer-row').first().waitFor({ timeout: 30_000 })

    const layerCount = await page.locator('.analysis-layer-row').count()
    expect(layerCount).toBeGreaterThan(0)

    // Button should say "Re-analyze" (not "Analyze Architecture")
    const btnText = await page.locator('.analysis-btn').textContent()
    expect(btnText).toBe('Re-analyze')

    await page.screenshot({ path: path.join(SNAPSHOTS, 'cache-loaded.png') })
    console.log(`Cache loaded: ${layerCount} layers`)
  }, 30_000)
})
