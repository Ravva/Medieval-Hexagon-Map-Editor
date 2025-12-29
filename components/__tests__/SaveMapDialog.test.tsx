import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SaveMapDialog } from '../SaveMapDialog'

// Mock File System Access API
Object.defineProperty(window, 'showDirectoryPicker', {
  writable: true,
  value: vi.fn(),
})

describe('SaveMapDialog', () => {
  const mockOnSave = vi.fn()
  const mockOnOpenChange = vi.fn()

  const defaultProps = {
    open: true,
    onOpenChange: mockOnOpenChange,
    onSave: mockOnSave,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders with default values', () => {
    render(<SaveMapDialog {...defaultProps} />)

    expect(screen.getByText('Save Map')).toBeInTheDocument()
    expect(screen.getByLabelText('Map Name *')).toBeInTheDocument()
    expect(screen.getByLabelText('Description')).toBeInTheDocument()
    expect(screen.getByLabelText('Save Location')).toBeInTheDocument()
    expect(screen.getByText('Browse')).toBeInTheDocument()
  })

  it('updates filename when name changes', async () => {
    render(<SaveMapDialog {...defaultProps} />)

    const nameInput = screen.getByLabelText('Map Name *')
    fireEvent.change(nameInput, { target: { value: 'Test Map' } })

    // Filename is internal state, we test it through the save callback
    const saveButton = screen.getByText('Save Map')
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Map',
          filename: expect.stringMatching(/test_map-\d+\.json/),
        })
      )
    })
  })

  it('shows system folder picker when Browse is clicked', async () => {
    const mockDirectoryHandle = { name: 'TestFolder' }
    const mockShowDirectoryPicker = vi.fn().mockResolvedValue(mockDirectoryHandle)
    window.showDirectoryPicker = mockShowDirectoryPicker

    render(<SaveMapDialog {...defaultProps} />)

    const browseButton = screen.getByText('Browse')
    fireEvent.click(browseButton)

    await waitFor(() => {
      expect(mockShowDirectoryPicker).toHaveBeenCalled()
    })
  })

  it('calls onSave with correct data including folder', async () => {
    render(<SaveMapDialog {...defaultProps} />)

    const nameInput = screen.getByLabelText('Map Name *')
    const descriptionInput = screen.getByLabelText('Description')

    fireEvent.change(nameInput, { target: { value: 'Test Map' } })
    fireEvent.change(descriptionInput, { target: { value: 'Test description' } })

    const saveButton = screen.getByText('Save Map')
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Map',
          description: 'Test description',
          folder: 'Downloads', // Default folder
        })
      )
    })
  })

  it('disables save button when name is empty', () => {
    render(<SaveMapDialog {...defaultProps} />)

    const nameInput = screen.getByLabelText('Map Name *')
    fireEvent.change(nameInput, { target: { value: '' } })

    const saveButton = screen.getByText('Save Map')
    expect(saveButton).toBeDisabled()
  })

  it('shows default folder message when no folder selected', () => {
    render(<SaveMapDialog {...defaultProps} />)

    expect(screen.getByText('Files will be saved to your Downloads folder by default')).toBeInTheDocument()
  })
})
