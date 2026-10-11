"""Configurable feed-forward neural network utilities for NexusHarness."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import torch
from torch import Tensor, nn


class NexusNN(nn.Module):
    """A fully connected network with configurable ReLU hidden layers."""

    def __init__(
        self,
        input_nodes: int,
        hidden_nodes: Sequence[int],
        output_nodes: int,
    ) -> None:
        super().__init__()
        self.input_nodes = self._validate_width("input_nodes", input_nodes)
        self.hidden_nodes = tuple(
            self._validate_width(f"hidden_nodes[{index}]", width)
            for index, width in enumerate(hidden_nodes)
        )
        self.output_nodes = self._validate_width("output_nodes", output_nodes)

        widths = (self.input_nodes, *self.hidden_nodes)
        self.hidden_layers = nn.ModuleList(
            nn.Linear(source, target)
            for source, target in zip(widths, self.hidden_nodes)
        )
        output_input_nodes = self.hidden_nodes[-1] if self.hidden_nodes else self.input_nodes
        self.output_layer = nn.Linear(output_input_nodes, self.output_nodes)
        self.activation = nn.ReLU()

    @staticmethod
    def _validate_width(name: str, value: int) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise ValueError(f"{name} must be a positive integer.")
        return value

    def forward(self, inputs: Tensor) -> Tensor:
        output = inputs
        for layer in self.hidden_layers:
            output = self.activation(layer(output))
        return self.output_layer(output)

    def get_network_structure(self) -> dict[str, Any]:
        """Return JSON-serializable topology and current trainable parameters."""
        layers: list[dict[str, Any]] = [
            {
                "index": 0,
                "name": "input",
                "type": "Input",
                "nodes": self.input_nodes,
                "activation": None,
                "weights": [],
                "bias": [],
                "active_weight_count": 0,
            }
        ]

        linear_layers = [*self.hidden_layers, self.output_layer]
        with torch.no_grad():
            for index, layer in enumerate(linear_layers, start=1):
                is_output = index == len(linear_layers)
                weights = layer.weight.detach().cpu()
                layers.append(
                    {
                        "index": index,
                        "name": "output" if is_output else f"hidden_{index}",
                        "type": "Linear",
                        "input_nodes": layer.in_features,
                        "nodes": layer.out_features,
                        "activation": None if is_output else "ReLU",
                        "weights": weights.tolist(),
                        "bias": layer.bias.detach().cpu().tolist() if layer.bias is not None else [],
                        "active_weight_count": int(torch.count_nonzero(weights).item()),
                    }
                )

        return {
            "network": self.__class__.__name__,
            "input_nodes": self.input_nodes,
            "hidden_nodes": list(self.hidden_nodes),
            "output_nodes": self.output_nodes,
            "layer_count": len(layers),
            "trainable_parameter_count": sum(parameter.numel() for parameter in self.parameters() if parameter.requires_grad),
            "layers": layers,
        }


def train_mock_network(
    *,
    input_nodes: int = 8,
    hidden_nodes: Sequence[int] = (16, 8),
    output_nodes: int = 2,
    samples: int = 64,
    epochs: int = 50,
    learning_rate: float = 0.01,
    seed: int = 7,
) -> tuple[NexusNN, list[float]]:
    """Train a NexusNN on deterministic mock regression data."""
    if samples <= 0 or epochs <= 0 or learning_rate <= 0:
        raise ValueError("samples, epochs, and learning_rate must be positive.")

    torch.manual_seed(seed)
    network = NexusNN(input_nodes, hidden_nodes, output_nodes)
    mock_inputs = torch.randn(samples, input_nodes)
    target_projection = torch.randn(input_nodes, output_nodes)
    mock_targets = mock_inputs @ target_projection

    optimizer = torch.optim.Adam(network.parameters(), lr=learning_rate)
    loss_function = nn.MSELoss()
    losses: list[float] = []

    network.train()
    for _ in range(epochs):
        optimizer.zero_grad(set_to_none=True)
        predictions = network(mock_inputs)
        loss = loss_function(predictions, mock_targets)
        loss.backward()
        optimizer.step()
        losses.append(float(loss.detach().item()))

    return network, losses


if __name__ == "__main__":
    trained_network, training_losses = train_mock_network()
    print(f"Initial loss: {training_losses[0]:.6f}")
    print(f"Final loss:   {training_losses[-1]:.6f}")
    print(f"Layers:       {trained_network.get_network_structure()['layer_count']}")
