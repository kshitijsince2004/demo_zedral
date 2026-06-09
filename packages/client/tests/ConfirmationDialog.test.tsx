import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ConfirmationDialog } from '../src/components/admin/ConfirmationDialog';

describe('ConfirmationDialog component', () => {
  it('does not render when isOpen is false', () => {
    render(
      <ConfirmationDialog
        isOpen={false}
        title="Test Dialog"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      >
        <p>Dialog content</p>
      </ConfirmationDialog>
    );
    
    expect(screen.queryByText('Test Dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Dialog content')).not.toBeInTheDocument();
  });

  it('renders correctly when isOpen is true', () => {
    render(
      <ConfirmationDialog
        isOpen={true}
        title="Test Dialog"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      >
        <p>Dialog content</p>
      </ConfirmationDialog>
    );
    
    expect(screen.getByText('Test Dialog')).toBeInTheDocument();
    expect(screen.getByText('Dialog content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save configuration/i })).toBeInTheDocument();
  });

  it('calls onClose when Cancel button is clicked', () => {
    const handleClose = vi.fn();
    render(
      <ConfirmationDialog
        isOpen={true}
        title="Test Dialog"
        onClose={handleClose}
        onConfirm={vi.fn()}
      >
        <p>Dialog content</p>
      </ConfirmationDialog>
    );
    
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('calls onConfirm when Save Configuration button is clicked', () => {
    const handleConfirm = vi.fn();
    render(
      <ConfirmationDialog
        isOpen={true}
        title="Test Dialog"
        onClose={vi.fn()}
        onConfirm={handleConfirm}
      >
        <p>Dialog content</p>
      </ConfirmationDialog>
    );
    
    fireEvent.click(screen.getByRole('button', { name: /save configuration/i }));
    expect(handleConfirm).toHaveBeenCalledTimes(1);
  });
});
