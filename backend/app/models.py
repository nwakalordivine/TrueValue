"""Tables follow the team's 'True Value: core data models' document.

Each catalog table keeps its key columns as real columns (for joins and filters) and the
full record in a JSON `data` column, so the API returns exactly the shape the frontend
already uses. Score is computed on request and never stored as truth.
"""
from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, Float, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

JsonType = JSON().with_variant(JSONB(), "postgresql")


class DataSource(Base):
    __tablename__ = "data_sources"
    source_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    type: Mapped[str] = mapped_column(String(64))
    trust_tier: Mapped[int | None] = mapped_column(Integer, nullable=True)
    data: Mapped[dict] = mapped_column(JsonType)


class EthicalDimension(Base):
    __tablename__ = "ethical_dimensions"
    dimension_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    label: Mapped[str] = mapped_column(String(128))
    default_weight: Mapped[float] = mapped_column(Float)
    data: Mapped[dict] = mapped_column(JsonType)


class Company(Base):
    __tablename__ = "companies"
    company_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    legal_name: Mapped[str] = mapped_column(String(255))
    parent_company_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ownership_status: Mapped[str] = mapped_column(String(16))
    data: Mapped[dict] = mapped_column(JsonType)


class Product(Base):
    __tablename__ = "products"
    product_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    barcode: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    brand: Mapped[str | None] = mapped_column(String(255), nullable=True)
    company_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    category: Mapped[str | None] = mapped_column(String(64), index=True)
    data: Mapped[dict] = mapped_column(JsonType)


class Certification(Base):
    __tablename__ = "certifications"
    certification_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    data: Mapped[dict] = mapped_column(JsonType)


class ProductCertification(Base):
    __tablename__ = "product_certifications"
    product_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    certification_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    status: Mapped[str] = mapped_column(String(16))
    data: Mapped[dict] = mapped_column(JsonType)


class Claim(Base):
    __tablename__ = "claims"
    claim_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    product_id: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    dimension_id: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16))
    data: Mapped[dict] = mapped_column(JsonType)


class Retailer(Base):
    __tablename__ = "retailers"
    retailer_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    data: Mapped[dict] = mapped_column(JsonType)


class PriceObservation(Base):
    __tablename__ = "price_observations"
    price_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    product_id: Mapped[str] = mapped_column(String(64), index=True)
    retailer_id: Mapped[str] = mapped_column(String(64))
    price: Mapped[float] = mapped_column(Float)
    data: Mapped[dict] = mapped_column(JsonType)


class Feedback(Base):
    __tablename__ = "feedback"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    product_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    issue: Mapped[str] = mapped_column(String(64))
    message: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="pending-review")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Corporation(Base):
    """Real data: Corporations Canada, active CBCA corporations (loaded by scripts/import_corporations.py)."""
    __tablename__ = "corporations"
    corporation_number: Mapped[str] = mapped_column(String(16), primary_key=True)
    business_number: Mapped[str | None] = mapped_column(String(16), nullable=True)
    name: Mapped[str] = mapped_column(String(512))
    alt_name: Mapped[str | None] = mapped_column(String(512), nullable=True)
    name_normalized: Mapped[str] = mapped_column(String(512))
    status_detail: Mapped[str | None] = mapped_column(String(128), nullable=True)
    incorporated_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_filing_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    city: Mapped[str | None] = mapped_column(String(128), nullable=True)
    province: Mapped[str | None] = mapped_column(String(8), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    is_numbered: Mapped[bool] = mapped_column(Boolean, default=False)


CATALOG_TABLES = {
    # json file name -> (model, key fields copied into columns)
    "dataSources": (DataSource, {"source_id": "source_id", "name": "name", "type": "type", "trust_tier": "trust_tier"}),
    "ethicalDimensions": (EthicalDimension, {"dimension_id": "dimension_id", "label": "label",
                                             "default_weight": "default_weight"}),
    "companies": (Company, {"company_id": "company_id", "legal_name": "legal_name",
                            "parent_company_id": "parent_company_id", "ownership_status": "ownership_status"}),
    "products": (Product, {"product_id": "product_id", "barcode": "barcode", "name": "name", "brand": "brand",
                           "company_id": "company_id", "category": "category"}),
    "certifications": (Certification, {"certification_id": "certification_id", "name": "name"}),
    "productCertifications": (ProductCertification, {"product_id": "product_id",
                                                     "certification_id": "certification_id", "status": "status"}),
    "claims": (Claim, {"claim_id": "claim_id", "product_id": "product_id", "dimension_id": "dimension_id",
                       "status": "status"}),
    "retailers": (Retailer, {"retailer_id": "retailer_id", "name": "name"}),
    "priceObservations": (PriceObservation, {"price_id": "price_id", "product_id": "product_id",
                                             "retailer_id": "retailer_id", "price": "price"}),
}
