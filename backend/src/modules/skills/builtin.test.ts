import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadBuiltinSkills, parseSkillFile, renderSkill } from './builtin.js';

test('a SKILL.md frontmatter gives name, description and requirement', () => {
  const skill = parseSkillFile(
    'degreeworks-map',
    '---\r\nname: Degree Works map\r\ndescription: "Use when the student asks what is left for their degree."\r\nrequires: degreeworks   # only with Degree Works\r\n---\r\n# Degree Works map\r\nCall degreeworks_audit.\r\n',
  );
  assert.deepEqual(skill, {
    slug: 'degreeworks-map',
    name: 'Degree Works map',
    description: 'Use when the student asks what is left for their degree.',
    requires: 'degreeworks',
    body: '# Degree Works map\r\nCall degreeworks_audit.',
  });
  assert.equal(parseSkillFile('x', '# no frontmatter'), null);
  assert.equal(parseSkillFile('x', '---\nname: Only a name\n---\nbody'), null, 'description is required');
  assert.equal(parseSkillFile('x', '---\nname: A\ndescription: B\nrequires: blackboard\n---\nbody')?.requires, undefined, 'unknown requirements are ignored');
});

test('placeholders are filled, unknown ones vanish', () => {
  const out = renderSkill('Hi {{user.display_name}} at {{ institution.name }}. {{user.password}}{{other}}', {
    'user.display_name': 'Fabrizio',
    'institution.name': 'FGCU',
  });
  assert.equal(out, 'Hi Fabrizio at FGCU. {{other}}');
});

test('the shipped skills all parse and only use known placeholders', () => {
  const skills = loadBuiltinSkills();
  for (const skill of skills) {
    const unknown = [...skill.body.matchAll(/\{\{\s*([a-z_.]+)\s*\}\}/g)]
      .map((m) => m[1])
      .filter((key) => !['user.display_name', 'user.major', 'user.language', 'institution.name', 'institution.canvas_base_url', 'institution.degreeworks_url'].includes(key!));
    assert.deepEqual(unknown, [], `${skill.slug} uses unknown placeholders`);
    assert.ok(skill.description.length >= 20, `${skill.slug} needs a real "when to use" description`);
  }
});
