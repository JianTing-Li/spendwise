import {afterEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({local:vi.fn(),create:vi.fn(),initialize:vi.fn(),version:vi.fn(),construct:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@electric-sql/pglite',()=>({PGlite:mocks.local}));
vi.mock('../src/server/db/pg',()=>({PgDatabase:{create:mocks.create}}));
vi.mock('../src/server/db/store',()=>({Store:class{constructor(...args:unknown[]){mocks.construct(...args);}initialize=mocks.initialize;assertVersion=mocks.version;}}));
vi.mock('../src/server/db/permissions',()=>({assertReadOnly:vi.fn(),assertApplication:vi.fn()}));
afterEach(()=>{
 delete (globalThis as typeof globalThis & {spendwiseStore?:unknown}).spendwiseStore;
 vi.resetAllMocks();vi.unstubAllEnvs();vi.resetModules();
});
function env(){
 vi.stubEnv('DATABASE_MODE','postgres');vi.stubEnv('VERCEL','');
 vi.stubEnv('DATABASE_URL','postgres://app@localhost/demo');
 vi.stubEnv('DATABASE_READONLY_URL','postgres://reader@localhost/demo');
 vi.stubEnv('DATABASE_MIGRATION_ROLE','migration');
}
it('database failure in PostgreSQL mode never opens local storage',async()=>{
 env();const close=vi.fn();mocks.create.mockReturnValue({transaction:vi.fn().mockRejectedValue(new Error('offline')),close});
 const {getStore}=await import('../src/server/db/local');
 await expect(getStore()).rejects.toThrow('offline');expect(mocks.local).not.toHaveBeenCalled();expect(close).toHaveBeenCalled();
});
it('PostgreSQL application startup checks version without running migrations',async()=>{
 env();const app={transaction:vi.fn().mockResolvedValue(undefined),close:vi.fn()};
 const reader={transaction:vi.fn().mockResolvedValue(undefined),close:vi.fn()};
 mocks.create.mockReturnValueOnce(app).mockReturnValueOnce(reader);
 const {getStore}=await import('../src/server/db/local');await getStore();
 expect(mocks.construct).toHaveBeenCalledWith(app,reader);expect(reader.close).not.toHaveBeenCalled();
 expect(mocks.version).toHaveBeenCalledOnce();expect(mocks.initialize).not.toHaveBeenCalled();expect(mocks.local).not.toHaveBeenCalled();
});
it('unknown mode fails before any adapter is created',async()=>{
 vi.stubEnv('DATABASE_MODE','unknown');const {getStore}=await import('../src/server/db/local');
 expect(()=>getStore()).toThrow('Invalid database mode');expect(mocks.local).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();
});
