import { describe, it, expect, vi, beforeEach } from 'vitest';
import { autoSourceService } from '../src/services/autoSourceService';
import { apiClient } from '../src/lib/apiClient';

vi.mock('../src/lib/apiClient', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

const mockedGet = vi.mocked(apiClient.get);

describe('autoSourceService.getPrefilledFields', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it('requests the /auto-source endpoint for the given process and coil (Req 4.1)', async () => {
    mockedGet.mockResolvedValue({ fields: {} });

    await autoSourceService.getPrefilledFields('CRM', 'COIL-100');

    expect(mockedGet).toHaveBeenCalledWith('/auto-source/CRM/COIL-100');
  });

  it('URL-encodes the coil number', async () => {
    mockedGet.mockResolvedValue({ fields: {} });

    await autoSourceService.getPrefilledFields('HRS', 'COIL/77 A');

    expect(mockedGet).toHaveBeenCalledWith('/auto-source/HRS/COIL%2F77%20A');
  });

  it('maps server sources to client-facing sourced values as editable prefills (Req 4.2, 4.3)', async () => {
    mockedGet.mockResolvedValue({
      fields: {
        inputThickness: { value: 3.2, source: 'PLANNING', isEditable: false },
        outputThickness: { value: 1.5, source: 'PLANNING', isEditable: true },
        hardness: { value: 85, source: 'GRADE_SPEC', isEditable: true },
        prevOut: { value: 2.0, source: 'PREVIOUS_PROCESS', isEditable: true },
        width: { value: 1250, source: 'COIL_MASTER', isEditable: false },
      },
    });

    const result = await autoSourceService.getPrefilledFields('CRM', 'COIL-100');

    expect(result.fields).toEqual({
      inputThickness: { value: 3.2, source: 'planning', editable: false },
      outputThickness: { value: 1.5, source: 'planning', editable: true },
      hardness: { value: 85, source: 'grade_spec', editable: true },
      prevOut: { value: 2.0, source: 'previous_process', editable: true },
      width: { value: 1250, source: 'coil_master', editable: false },
    });
  });

  it('omits MANUAL fields so they render empty for manual entry (Req 4.4)', async () => {
    mockedGet.mockResolvedValue({
      fields: {
        width: { value: 1250, source: 'PLANNING', isEditable: true },
        elongation: { value: null, source: 'MANUAL', isEditable: true },
      },
    });

    const result = await autoSourceService.getPrefilledFields('CRM', 'COIL-100');

    expect(result.fields).toHaveProperty('width');
    expect(result.fields).not.toHaveProperty('elongation');
  });

  it('omits sourced fields that carry no value', async () => {
    mockedGet.mockResolvedValue({
      fields: {
        width: { value: null, source: 'PLANNING', isEditable: true },
        thickness: { value: undefined, source: 'COIL_MASTER', isEditable: true },
      },
    });

    const result = await autoSourceService.getPrefilledFields('PKL', 'COIL-1');

    expect(result.fields).toEqual({});
  });

  it('returns an empty field map when the endpoint reports nothing', async () => {
    mockedGet.mockResolvedValue({ fields: {} });

    const result = await autoSourceService.getPrefilledFields('ANN', 'COIL-9');

    expect(result.fields).toEqual({});
  });

  it('does not fall back to mock data when the endpoint fails (Req 4.5)', async () => {
    const error = new Error('Network unavailable');
    mockedGet.mockRejectedValue(error);

    await expect(
      autoSourceService.getPrefilledFields('CRM', 'COIL-100'),
    ).rejects.toThrow('Network unavailable');
  });
});
