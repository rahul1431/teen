import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import Finance from '../src/pages/Finance'
import { adminApi } from '../src/api/client'

vi.mock('../src/api/client', () => ({
  adminApi: { get: vi.fn(), patch: vi.fn() },
}))

describe('Withdrawals tab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(adminApi.get as any).mockImplementation((url: string) => {
      if (url === '/finance/stats') return Promise.resolve({ data: {} })
      if (url === '/finance/withdrawals') return Promise.resolve({ data: [] })
      return Promise.resolve({ data: {} })
    })
  })

  it('fetches a 15-row all-status page for the Recents card on mount', async () => {
    render(<Finance />)
    await waitFor(() => {
      expect(adminApi.get).toHaveBeenCalledWith('/finance/withdrawals', { params: { status: 'all', limit: 15 } })
    })
  })

  it('offers an "All" option in the status filter', async () => {
    render(<Finance />)
    await waitFor(() => expect(screen.getByText('Recent Withdrawals')).toBeInTheDocument())
    // antd's Select (rc-select) only mounts its option-list portal once the
    // dropdown is opened, so open it before looking for the "All" option.
    const selectors = document.querySelectorAll('.ant-select-selector')
    fireEvent.mouseDown(selectors[0])
    await waitFor(() => expect(screen.getAllByText('All').length).toBeGreaterThan(0))
  })

  it('refetches the main table with status=all when "All" is selected in the status filter', async () => {
    render(<Finance />)
    await waitFor(() => expect(screen.getByText('Recent Withdrawals')).toBeInTheDocument())

    // Initial mount load() call uses the default status ('created').
    await waitFor(() => {
      expect(adminApi.get).toHaveBeenCalledWith('/finance/withdrawals', { params: { status: 'created' } })
    })

    // The recents card has no per-row status Select while its dataSource is
    // empty, so the first (and only) .ant-select-selector on the page at
    // this point is the main status filter.
    const selectors = document.querySelectorAll('.ant-select-selector')
    fireEvent.mouseDown(selectors[0])
    await waitFor(() => expect(screen.getAllByText('All').length).toBeGreaterThan(0))

    // The currently-selected value is "Pending", so "All" appears once: the
    // dropdown option. Take the last match in case a duplicate render exists.
    const allOption = screen.getAllByText('All').pop()
    expect(allOption).toBeTruthy()
    fireEvent.click(allOption!)

    await waitFor(() => {
      expect(adminApi.get).toHaveBeenCalledWith('/finance/withdrawals', { params: { status: 'all' } })
    })
  })
})
