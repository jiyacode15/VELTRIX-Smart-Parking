import unittest

from fastapi.testclient import TestClient

from backend.app.main import app


class RoutePredictionApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_route_and_parking_endpoint_exists_and_returns_structured_response(self):
        payload = {
            "origin": {"lat": 19.0760, "lon": 72.8777},
            "destination": {"lat": 19.0630, "lon": 72.9975},
            "radius_km": 5,
            "arrival_minutes": 20,
        }

        response = self.client.post('/api/route-and-parking', json=payload)
        self.assertNotEqual(response.status_code, 404, 'route-and-parking endpoint must exist')
        self.assertIn('route', response.json())
        self.assertIn('parking_recommendations', response.json())


if __name__ == '__main__':
    unittest.main()
