import { expect, test } from '@playwright/test'

const SHOTS = process.env.CHRONOS_SHOTS ?? 'test-results/shots'

test('研究コンソール: 実験を操作し結果と根拠を確認できる', async ({ page }) => {
  await page.goto('/#/dashboard')
  await expect(page.getByTestId('api-status')).toContainText('オンライン')
  await expect(page.getByTestId('field-eq')).toContainText('Λ = -1/(2*a**2)', { timeout: 30_000 })
  await expect(page.getByTestId('constraints')).toContainText('時間順序保護仮説')

  // --- 実験制御: 円軌道（自動再計算プレビュー）
  await page.getByTestId('tab-control').click()
  await page.getByTestId('type-circle').click()
  await expect(page.getByTestId('verdict-label')).toContainText('閉じた時間的曲線（CTC）である')
  await expect(page.getByTestId('evidence-table')).toContainText('g_φφ')
  await page.getByTestId('f-R').fill('0.5')
  await expect(page.getByTestId('verdict-label')).toContainText('CTCではない')
  await expect(page.getByTestId('metric-compare')).toBeVisible()
  await page.getByTestId('f-R').fill('0.881373587019543')
  await expect(page.getByTestId('verdict-panel')).toContainText('判定不能')
  await page.getByTestId('f-R').fill('1.2')
  await expect(page.getByTestId('verdict-label')).toContainText('CTC')

  // 実験開始 → 完了
  await page.getByTestId('btn-start').click()
  await expect(page.getByText('完了').first()).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: `${SHOTS}/control-circle.png`, fullPage: true })

  // --- 過去到達ミッション
  await page.getByTestId('type-mission').click()
  await expect(page.getByTestId('verdict-label')).toContainText('出発前の時刻に出発地点へ戻る', { timeout: 30_000 })
  await page.getByTestId('btn-start').click()
  await expect(page.getByTestId('btn-open-analysis')).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: `${SHOTS}/control-mission.png`, fullPage: true })

  // --- 測地線: 長い積分を開始して停止
  await page.getByTestId('type-geodesic').click()
  await page.getByTestId('auto-recompute').uncheck()
  await page.getByTestId('f-lock_L0').uncheck()
  await page.getByTestId('f-kind').selectOption('timelike')
  await page.getByTestId('f-r0').fill('0.5')
  await page.getByTestId('f-psi_deg').fill('60')
  await page.getByTestId('f-lambda_max').fill('200')
  await page.getByTestId('btn-start').click()
  await expect(page.getByTestId('btn-stop')).toBeEnabled({ timeout: 10_000 })
  await page.getByTestId('btn-stop').click()
  await expect(page.getByTestId('btn-stop')).toBeDisabled({ timeout: 30_000 })

  // --- 時空ビジュアライザ
  await page.getByTestId('tab-visualizer').click()
  await expect(page.locator('[data-testid="visualizer-3d"] canvas')).toBeVisible()
  await expect(page.getByTestId('chart-tilt')).toBeVisible()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${SHOTS}/visualizer.png`, fullPage: true })
  // カメラ操作（回転・ズーム）
  const canvas = page.locator('[data-testid="visualizer-3d"] canvas')
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2 + 40, { steps: 10 })
  await page.mouse.up()
  await page.mouse.wheel(0, -300)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${SHOTS}/visualizer-rotated.png` })
  await page.getByTestId('model-minkowski').click()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${SHOTS}/visualizer-minkowski.png` })
  await page.getByTestId('model-godel').click()

  // --- 結果解析: 詳細・比較・ダウンロード
  await page.getByTestId('tab-analysis').click()
  await page.getByTestId('analysis-list').getByText('過去到達ミッション').first().click()
  await expect(page.getByTestId('comparison-table')).toContainText('α_max')
  await expect(page.getByTestId('error-list')).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByTestId('download-json').click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/CHRONOS-001-\d+\.json/)
  await page.screenshot({ path: `${SHOTS}/analysis.png`, fullPage: true })

  const compares = page.locator('[data-testid^="compare-"]:not([disabled])')
  await compares.nth(0).check()
  await compares.nth(1).check()
  await expect(page.getByTestId('comparison')).toBeVisible()
  await page.getByTestId('comparison').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${SHOTS}/analysis-compare.png`, fullPage: true })

  await page.getByTestId('tab-dashboard').click()
  await expect(page.getByTestId('history-table')).toContainText('CHRONOS-001')
  await page.screenshot({ path: `${SHOTS}/dashboard.png`, fullPage: true })
})
