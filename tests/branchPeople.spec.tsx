import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BranchPeople } from '../src/components/branchPeople';
import type { BranchPeople as People } from '../src/statusTypes';

const people: People = {
  creator: { name: 'Alice', email: 'alice@example.test', commits: 0, sampleSha: null, githubLogin: null, avatarUrl: null },
  contributors: [
    { name: 'Alice', email: 'alice@example.test', commits: 2, sampleSha: 'a'.repeat(40), githubLogin: null, avatarUrl: null },
    { name: 'Bob', email: 'bob@example.test', commits: 1, sampleSha: 'b'.repeat(40), githubLogin: null, avatarUrl: null },
  ],
  scope: 'sinceCreation',
};

test('shows creator once, all contributors, and current Git identity', () => {
  const markup = renderToStaticMarkup(<BranchPeople people={people} currentGitEmail="alice@example.test" avatars={{ ['b'.repeat(40)]: { login: 'bob', avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4' } }} />);
  expect(markup).toContain('创建者：Alice · 2 次提交 · 与当前 Git 身份一致');
  expect(markup).toContain('我创建');
  expect(markup).toContain('建分支后提交者：Bob · 1 次提交');
  expect(markup).toContain('https://avatars.githubusercontent.com/u/1?v=4');
  expect(markup.match(/class="personAvatar/g)?.length).toBe(2);
});

test('states when the branch creator cannot be established', () => {
  const markup = renderToStaticMarkup(<BranchPeople people={{ ...people, creator: null }} currentGitEmail={null} avatars={{}} />);
  expect(markup).toContain('创建者未知');
});
