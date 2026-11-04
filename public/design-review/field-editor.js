/** One inline field/table vocabulary for additional business fields. No page-specific visual styles. */
import { esc, btn, table } from './ui.js';
import { pick } from './i18n.js';
const names = {
  name: ['名称', 'Name'],
  nameZh: ['中文名称', 'Chinese name'],
  description: ['描述', 'Description'],
  category: ['分类', 'Category'],
  code: ['编码', 'Code'],
  active: ['启用', 'Active'],
  item: ['条目', 'Item'],
  supplier: ['供应商', 'Supplier'],
  pricingBasis: ['定价依据', 'Pricing basis'],
  unit: ['单位', 'Unit'],
  unitPrice: ['单价', 'Unit price'],
  quantity: ['数量', 'Quantity'],
  bu: ['业务单元', 'BU'],
  currency: ['币种', 'Currency'],
  owner: ['负责人', 'Owner'],
  note: ['备注', 'Note'],
  requiredFields: ['必填字段', 'Required fields'],
  defaultAssumptionIds: ['默认假设', 'Default assumptions'],
  termsAndConditions: ['条款', 'Terms'],
  paymentTerms: ['付款条款', 'Payment terms'],
  validityDays: ['有效天数', 'Validity days'],
  referenceId: ['历史参考', 'Reference'],
  serviceLevel: ['服务等级', 'SLA'],
  site: ['站点', 'Site'],
  basis: ['选价依据', 'Pricing basis'],
  source: ['来源', 'Source'],
  remark: ['备注', 'Remark'],
  text: ['英文内容', 'English text'],
  textZh: ['中文内容', 'Chinese text'],
  excel: ['Excel 映射', 'Excel mapping'],
  sheetName: ['工作表名称', 'Sheet name'],
  cell: ['单元格', 'Cell'],
  section: ['章节', 'Section'],
  inclusion: ['计入章节', 'Section membership'],
  targetGrossMargin: ['目标 GP %', 'Target GP %'],
  manualTargetPrice: ['目标售价', 'Target price'],
  ratePercent: ['分成率 %', 'Share rate %'],
  mandayRate: ['人天费率', 'Manday rate'],
};
export const fieldName = (k) =>
  names[k] ? pick(...names[k]) : k.replace(/([a-z])([A-Z])/g, '$1 $2');
export function resolveSchema(spec = {}, caps) {
  if (spec.$ref) {
    const cost = spec.$ref.includes('cost-export');
    const key = spec.$ref.split('/').at(-1);
    return resolveSchema(
      (cost ? caps.costSchema : caps.workspaceSchema).$defs[key] ||
        caps.costSchema.$defs[key] ||
        {},
      caps,
    );
  }
  if (spec.anyOf || spec.oneOf) {
    const alternatives = spec.anyOf || spec.oneOf;
    return {
      ...resolveSchema(alternatives.find((s) => s.type !== 'null') || {}, caps),
      nullable: alternatives.some((s) => s.type === 'null'),
    };
  }
  if (Array.isArray(spec.type))
    return {
      ...spec,
      type: spec.type.find((t) => t !== 'null'),
      nullable: spec.type.includes('null'),
    };
  return spec;
}
export function defaultField(spec, caps) {
  const s = resolveSchema(spec, caps);
  if (s.default !== undefined) return structuredClone(s.default);
  if (s.enum) return s.enum[0];
  if (s.type === 'object')
    return Object.fromEntries(
      (s.required || []).map((k) => [
        k,
        k === 'id'
          ? crypto.randomUUID()
          : defaultField(s.properties?.[k], caps),
      ]),
    );
  if (s.type === 'array') return [];
  if (s.type === 'boolean') return false;
  if (s.type === 'number' || s.type === 'integer') return s.minimum ?? 0;
  return '';
}
const attrs = (path) => `data-extra-path="${esc(JSON.stringify(path))}"`;
export function fieldEditor(value, spec, caps, path = [], readOnly = false) {
  const s = resolveSchema(spec, caps),
    type = s.type || (Array.isArray(value) ? 'array' : typeof value);
  if (type === 'array' || Array.isArray(value)) {
    const items = value || [],
      item = s.items || {};
    return `<div class="details-content">${items.map((v, i) => `<div class="toolbar"><strong>${i + 1}</strong><span class="grow"></span>${readOnly ? '' : btn(pick('移除', 'Remove'), 'extra-field-remove', false, '', attrs([...path, i]))}</div>${fieldEditor(v, item, caps, [...path, i], readOnly)}`).join('')}${readOnly ? '' : btn(pick('添加一项', 'Add item'), 'extra-field-add', false, 'plus', attrs(path))}</div>`;
  }
  if (type === 'object' || (value && typeof value === 'object')) {
    const keys = [
      ...new Set([
        ...Object.keys(s.properties || {}),
        ...Object.keys(value || {}),
      ]),
    ];
    const leaf = [],
      nested = [];
    for (const key of keys) {
      const child = resolveSchema(
          s.properties?.[key] ||
            (typeof s.additionalProperties === 'object'
              ? s.additionalProperties
              : {}),
          caps,
        ),
        v = value?.[key];
      const p = [...path, key];
      if (
        child.type === 'object' ||
        child.type === 'array' ||
        (v && typeof v === 'object')
      )
        nested.push(
          `<details class="panel details-panel"><summary>${esc(fieldName(key))}</summary>${v === undefined ? `<div class="details-content">${readOnly ? '—' : btn(pick('启用此设置', 'Configure'), 'extra-field-create', false, '', attrs(p))}</div>` : fieldEditor(v, child, caps, p, readOnly)}</details>`,
        );
      else
        leaf.push(
          `<tr><td>${esc(fieldName(key))}${s.required?.includes(key) ? ' *' : ''}</td><td class="edit">${fieldEditor(v, child, caps, p, readOnly || key === 'id')}</td></tr>`,
        );
    }
    return (
      table([pick('字段', 'Field'), pick('值', 'Value')], leaf.join('')) +
      nested.join('') +
      (!readOnly && s.additionalProperties && s.additionalProperties !== false
        ? `<div class="toolbar"><input data-extra-dictionary-key aria-label="${pick('新字段名称', 'New field name')}">${btn(pick('添加字段', 'Add field'), 'extra-field-key-add', false, 'plus', attrs(path))}</div>`
        : '')
    );
  }
  const label = esc(path.map(fieldName).join(' / ')),
    disabled = readOnly ? 'disabled' : '';
  if (s.enum)
    return `<select ${attrs(path)} aria-label="${label}" ${disabled}><option value="">—</option>${s.enum.map((v) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
  if (type === 'boolean')
    return `<input type="checkbox" ${attrs(path)} aria-label="${label}" ${value ? 'checked' : ''} ${disabled}>`;
  if (type === 'number' || type === 'integer')
    return `<input type="number" step="${type === 'integer' ? '1' : 'any'}" ${attrs(path)} ${s.nullable ? 'data-nullable' : ''} aria-label="${label}" value="${esc(value ?? '')}" ${s.minimum !== undefined ? `min="${s.minimum}"` : ''} ${disabled}>`;
  return `<input type="text" ${attrs(path)} aria-label="${label}" value="${esc(value ?? '')}" ${s.maxLength ? `maxlength="${s.maxLength}"` : ''} ${disabled}>`;
}
export function fieldAt(object, path) {
  return path.reduce((o, k) => o?.[k], object);
}
export function schemaAt(spec, path, caps) {
  return path.reduce((s, k) => {
    s = resolveSchema(s, caps);
    return typeof k === 'number'
      ? s.items || {}
      : s.properties?.[k] ||
          (typeof s.additionalProperties === 'object'
            ? s.additionalProperties
            : {});
  }, spec);
}
export function updateField(object, path, value) {
  if (!path.length) throw new Error('Cannot replace editor root');
  let node = object;
  for (const k of path.slice(0, -1)) {
    if (['__proto__', 'prototype', 'constructor'].includes(String(k)))
      throw new Error('Invalid field');
    node = node[k];
  }
  const last = path.at(-1);
  if (['__proto__', 'prototype', 'constructor'].includes(String(last)))
    throw new Error('Invalid field');
  if (value === undefined) delete node[last];
  else node[last] = value;
}
