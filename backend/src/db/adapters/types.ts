export type DatabaseTableColumn = {
  tableName: string;
  columnName: string;
  dataType: string;
  isNullable: string;
};

export type ReadOnlyQueryResult = {
  rows: Record<string, unknown>[];
  rowCount: number;
  query: string;
};

export type DatabaseAdapter = {
  dialect: string;
  listTables: () => Promise<string[]>;
  getSchemaRows: () => Promise<DatabaseTableColumn[]>;
  getTableSchema: (tableName: string) => Promise<DatabaseTableColumn[]>;
  listAllowedTables: () => Promise<Set<string>>;
  executeReadOnlyQuery: (query: string) => Promise<ReadOnlyQueryResult>;
};
