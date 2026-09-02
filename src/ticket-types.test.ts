import { describe, it, expect } from 'vitest';
import { TICKET_TYPES, listTicketTypes, getTicketType, validateRequiredFields, buildQuery } from './ticket-types.js';
import { ValidationError } from './errors.js';

describe('ticket-type registry', () => {
  it('lists all four configured ticket types', () => {
    const types = listTicketTypes();
    const keys = types.map(type => type.key).sort();
    expect(keys).toEqual(['creq', 'inquiry', 'issue', 'service_request']);
  });

  it('resolves a known ticket type by key', () => {
    const creq = getTicketType('creq');
    expect(creq.table).toBe('change_request');
  });

  it('throws a ValidationError for an unknown ticket type', () => {
    expect(() => getTicketType('bogus')).toThrow(ValidationError);
    expect(() => getTicketType('bogus')).toThrow('Unknown ticket_type: bogus');
  });

  it('accepts data containing every required field', () => {
    const creq = getTicketType('creq');
    expect(() => validateRequiredFields(creq, { short_description: 'Network outage' })).not.toThrow();
  });

  it('throws a ValidationError naming every missing required field', () => {
    const type = {
      key: 'test_type',
      label: 'Test Type',
      table: 'x_test',
      fields: [
        { name: 'short_description', required: true },
        { name: 'category', required: true },
        { name: 'description', required: false }
      ]
    };

    expect(() => validateRequiredFields(type, {})).toThrow(
      'Missing required field(s) for test_type: short_description, category'
    );
  });

  it('builds a query combining the discriminator clause and an extra query', () => {
    const issue = getTicketType('issue');
    const combined = buildQuery(issue, 'active=true');
    expect(combined).toBe(`${issue.discriminatorField}=${issue.discriminatorValue}^active=true`);
  });

  it('builds a query with only the extra query when there is no discriminator', () => {
    const creq = getTicketType('creq');
    expect(buildQuery(creq, 'active=true')).toBe('active=true');
  });

  it('returns undefined when there is no discriminator and no extra query', () => {
    const creq = getTicketType('creq');
    expect(buildQuery(creq)).toBeUndefined();
  });

  it('exposes the four expected registry entries directly', () => {
    expect(Object.keys(TICKET_TYPES).sort()).toEqual(['creq', 'inquiry', 'issue', 'service_request']);
  });
});
