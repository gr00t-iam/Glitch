import json
import unittest

import torch

from server.nexus_nn import NexusNN, train_mock_network


class NexusNNTests(unittest.TestCase):
    def test_forward_shape_and_serializable_structure(self) -> None:
        network = NexusNN(input_nodes=4, hidden_nodes=(6, 3), output_nodes=2)
        output = network(torch.randn(5, 4))
        structure = network.get_network_structure()

        self.assertEqual(tuple(output.shape), (5, 2))
        self.assertEqual(structure["layer_count"], 4)
        self.assertEqual(structure["hidden_nodes"], [6, 3])
        self.assertEqual(structure["layers"][-1]["nodes"], 2)
        json.dumps(structure)

    def test_mock_training_updates_weights_and_reduces_loss(self) -> None:
        network, losses = train_mock_network(
            input_nodes=4,
            hidden_nodes=(8,),
            output_nodes=1,
            samples=48,
            epochs=80,
            learning_rate=0.02,
        )

        self.assertLess(losses[-1], losses[0])
        self.assertGreater(network.get_network_structure()["layers"][1]["active_weight_count"], 0)


if __name__ == "__main__":
    unittest.main()
