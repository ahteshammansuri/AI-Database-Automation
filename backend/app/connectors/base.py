from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional
from backend.app.schemas.connection import SchemaResponse, ConnectionTestResponse


class BaseDatabaseConnector(ABC):
    """Abstract interface for customer database connectors."""

    @abstractmethod
    def test_connection(self) -> ConnectionTestResponse:
        """Verify database connectivity and measure latency."""
        pass

    @abstractmethod
    def introspect_schema(self) -> SchemaResponse:
        """Perform read-only metadata discovery of tables, columns, constraints, and relationships."""
        pass

    @abstractmethod
    def resolve_foreign_key(
        self,
        lookup_table: str,
        lookup_column: str,
        lookup_value: Any,
        target_column: str = "id"
    ) -> Optional[Any]:
        """Resolve a foreign key reference from a lookup table safely."""
        pass

    @abstractmethod
    def execute_insert(
        self,
        table_name: str,
        column_values: Dict[str, Any],
        allowlisted_columns: List[str]
    ) -> Any:
        """Safely execute parameterized INSERT into allowlisted table."""
        pass

    @abstractmethod
    def execute_update(
        self,
        table_name: str,
        primary_key_column: str,
        primary_key_value: Any,
        column_values: Dict[str, Any],
        allowlisted_columns: List[str]
    ) -> int:
        """Safely execute parameterized UPDATE on identified record."""
        pass
