# TexTeller Inference Server

This document provides instructions on how to set up and run the TexTeller inference server.

## 1. Installation

The TexTeller server is a Python application that requires several dependencies. These dependencies are listed in the `TexTeller/pyproject.toml` file.

### Prerequisites

- Python 3.10 or higher
- `pip` and `venv` (or your preferred package manager)

### Setup

1.  **Create a virtual environment:**

    ```bash
    python -m venv venv
    source venv/bin/activate  # On Windows, use `venv\Scripts\activate`
    ```

2.  **Install dependencies:**

    Navigate to the `TexTeller` directory and install the required packages.

    ```bash
    cd TexTeller
    pip install -e .
    ```

    The `-e` flag installs the package in "editable" mode, which is convenient for development.

## 2. Running the Server

The TexTeller server can be started using the `texteller` command-line interface.

```bash
texteller launch
```

By default, the server will run on `http://0.0.0.0:8000`. You can change the port using the `--port` option:

```bash
texteller launch --port 8080
```

The server will automatically download the required model and tokenizer from Hugging Face if they are not found locally.

The inference endpoint is available at `http://<your-ip-address>:<port>/predict`.

## 3. API Usage

To use the API, send a `POST` request to the `/predict` endpoint with a multipart form data containing the image to be processed.

### Example using `curl`

```bash
curl -X POST -F "img=@/path/to/your/image.png" http://127.0.0.1:8000/predict
```
