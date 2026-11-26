"""The assistant answers product questions with real Open Food Facts products, never demo ones.

Open Food Facts is replaced by fakes here, so no network is needed.
"""
import asyncio
import json
import unittest
from pathlib import Path
from unittest import mock

from app.services import assistant, llm, openfoodfacts, parser

DATA = Path(__file__).resolve().parent.parent / "data"
PRODUCTS = json.loads((DATA / "products.json").read_text(encoding="utf-8"))
DEMO_IDS = {p["product_id"] for p in PRODUCTS}


def off_product(code, name, labels=(), made="", brand="Brand"):
    return {"code": code, "product_name": name, "brands": brand, "labels_tags": list(labels),
            "manufacturing_places": made, "categories_tags": ["en:beverages", "en:waters"],
            "packaging_materials_tags": ["en:aluminium"]}


REAL = {
    "1111111111116": off_product("1111111111116", "Spring Water Can", labels=["en:fair-trade"], made="Canada"),
    "2222222222228": off_product("2222222222228", "Plain Water Can"),
    "3333333333330": off_product("3333333333330", "Glacier Water", made="Canada"),
}


async def fake_search(query, limit=12, category=None, full=False):
    return [{"barcode": c, "name": p["product_name"], "brand": "Brand", "sold_in_canada": True, "product": p}
            for c, p in REAL.items()]


def ask(message):
    with mock.patch.object(llm, "enabled", return_value=False), \
         mock.patch.object(openfoodfacts, "search", fake_search):
        return asyncio.run(assistant.answer(message, None, None))


class SearchWords(unittest.TestCase):
    def terms(self, q):
        return parser.rule_parse(q, PRODUCTS)["search_terms"]

    def test_values_prices_and_filler_are_removed(self):
        self.assertEqual(self.terms("Would like to buy a canned water high on fair trade"), "canned water")
        self.assertEqual(self.terms("Canadian coffee under $15"), "coffee")
        self.assertEqual(self.terms("I want vegan dark chocolate with low waste packaging"), "dark chocolate")
        self.assertIsNone(self.terms("recommend something local"))

    def test_eco_inside_a_word_is_not_a_priority(self):
        self.assertEqual(parser.rule_parse("recommend something local", PRODUCTS)["priorities"], ["local_business"])

    def test_ai_search_words_are_checked(self):
        rule = parser.rule_parse("something nice", PRODUCTS)
        self.assertEqual(parser.merge_llm(rule, {"intent": "recommend", "search_terms": "Oat  Milk"}, PRODUCTS)
                         ["search_terms"], "oat milk")
        self.assertIsNone(parser.merge_llm(rule, {"intent": "recommend", "search_terms": "<script>"}, PRODUCTS)
                          ["search_terms"])


class CategoryTags(unittest.TestCase):
    def test_whole_words_only(self):
        self.assertEqual(openfoodfacts.category_tag("canned water"), "en:waters")
        self.assertEqual(openfoodfacts.category_tag("cookies"), "en:biscuits")
        self.assertEqual(openfoodfacts.category_tag("peanut butter"), "en:peanut-butters")
        self.assertIsNone(openfoodfacts.category_tag("popcorn"))
        self.assertIsNone(openfoodfacts.category_tag("teaspoon"))


class SearchHits(unittest.TestCase):
    def test_search_server_hit_is_scored_like_a_product_page(self):
        hit = {"code": "0066188004698", "product_name": "Instant Coffee", "brands": ["xx:maxwell house"],
               "labels": ["en:fair-trade", "en:organic"], "categories": ["en:beverages", "en:coffees"],
               "manufacturing_places": ["Canada"], "countries": ["en:canada"], "origins": ["en:brazil"],
               "packagings": [{"material": "en:metal"}], "environmental_score_grade": "b"}
        product, claims, facts = openfoodfacts.to_truevalue(openfoodfacts.from_search(hit))
        scores = {cl["dimension_id"]: cl["raw_score"] for cl in claims}
        self.assertEqual(scores["fair_trade"], 85)
        self.assertEqual(scores["canadian_ownership"], 70)
        self.assertEqual(scores["environment"], 75)
        self.assertEqual(product["category"], "Coffee")
        self.assertEqual(product["brand"], "Maxwell House")
        self.assertEqual(facts["origins"], "Brazil")


class RealAnswers(unittest.TestCase):
    def test_recommend_uses_only_real_products(self):
        out = ask("Would like to buy a canned water high on fair trade")
        self.assertEqual(len(out["products"]), 3)
        for card in out["products"]:
            self.assertFalse(card["demo_data"])
            self.assertTrue(card["product_id"].startswith("off-"))
            for alt in card["alternatives"]:
                self.assertNotIn(alt["product_id"], DEMO_IDS)
                self.assertTrue(alt["barcode"])
        self.assertEqual(out["products"][0]["name"], "Spring Water Can")  # the fair trade label wins
        self.assertNotIn("demo", out["summary"].lower())

    def test_price_limit_is_explained(self):
        out = ask("canned water under $5")
        self.assertTrue(any("price limit" in n for n in out["notes"]))

    def test_no_results_never_falls_back_to_demo(self):
        async def empty(query, limit=12, category=None, full=False):
            return []
        with mock.patch.object(llm, "enabled", return_value=False), mock.patch.object(openfoodfacts, "search", empty):
            out = asyncio.run(assistant.answer("fair trade coffee", None, None))
        self.assertEqual(out["products"], [])
        self.assertIn('"coffee"', out["summary"])

    def test_vague_question_asks_what_to_look_for(self):
        out = ask("recommend something local")
        self.assertEqual(out["products"], [])
        self.assertIn("What kind of product", out["summary"])

    def test_naming_a_demo_product_still_uses_it(self):
        out = ask("Compare Prairie Morning Coffee and Everyday Ground Coffee")
        self.assertTrue(all(card["demo_data"] for card in out["products"]))

    def test_scanned_product_gets_no_demo_alternatives(self):
        product, claims, facts = openfoodfacts.to_truevalue(REAL["2222222222228"])
        card = assistant.real_card(product, facts, assistant.catalog.default_weights(), claims)
        self.assertEqual(card["alternatives"], [])
