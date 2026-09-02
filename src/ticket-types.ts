import { ValidationError } from './errors.js';

export interface TicketFieldDef {
  name: string;
  required: boolean;
}

export interface TicketTypeDef {
  key: string;
  label: string;
  table: string;
  discriminatorField?: string;
  discriminatorValue?: string;
  fields: TicketFieldDef[];
}

export const TICKET_TYPES: Record<string, TicketTypeDef> = {
  inquiry: {
    key: 'inquiry',
    label: 'Inquiry',
    table: 'sn_customerservice_case',
    discriminatorField: 'contact_type',
    discriminatorValue: 'inquiry',
    fields: [
      { name: 'short_description', required: true },
      { name: 'description', required: false },
      { name: 'priority', required: false },
      { name: 'assignment_group', required: false }
    ]
  },
  issue: {
    key: 'issue',
    label: 'Issue (CS Ticket)',
    table: 'sn_customerservice_case',
    discriminatorField: 'contact_type',
    discriminatorValue: 'issue',
    fields: [
      { name: 'short_description', required: true },
      { name: 'description', required: false },
      { name: 'priority', required: false },
      { name: 'assignment_group', required: false }
    ]
  },
  service_request: {
    key: 'service_request',
    label: 'Service Request',
    table: 'sc_request',
    fields: [
      { name: 'short_description', required: true },
      { name: 'description', required: false },
      { name: 'priority', required: false }
    ]
  },
  creq: {
    key: 'creq',
    label: 'Change Request',
    table: 'change_request',
    fields: [
      { name: 'short_description', required: true },
      { name: 'description', required: false },
      { name: 'priority', required: false },
      { name: 'type', required: false }
    ]
  }
};

export function listTicketTypes(): TicketTypeDef[] {
  return Object.values(TICKET_TYPES);
}

export function getTicketType(key: string): TicketTypeDef {
  const type = TICKET_TYPES[key];
  if (!type) {
    throw new ValidationError(`Unknown ticket_type: ${key}`);
  }
  return type;
}

export function validateRequiredFields(type: TicketTypeDef, data: Record<string, unknown>): void {
  const missing = type.fields
    .filter(field => field.required)
    .map(field => field.name)
    .filter(name => data[name] === undefined || data[name] === null || data[name] === '');

  if (missing.length > 0) {
    throw new ValidationError(`Missing required field(s) for ${type.key}: ${missing.join(', ')}`);
  }
}

export function buildQuery(type: TicketTypeDef, extraQuery?: string): string | undefined {
  const parts: string[] = [];
  if (type.discriminatorField && type.discriminatorValue !== undefined) {
    parts.push(`${type.discriminatorField}=${type.discriminatorValue}`);
  }
  if (extraQuery) {
    if (type.discriminatorField && (extraQuery.startsWith('OR') || extraQuery.includes('^OR'))) {
      throw new ValidationError(
        `query must not start with or contain a top-level OR condition for ticket_type '${type.key}', since it would bypass the ${type.discriminatorField} scoping`
      );
    }
    parts.push(extraQuery);
  }
  return parts.length > 0 ? parts.join('^') : undefined;
}
