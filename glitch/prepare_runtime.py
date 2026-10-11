from glitch.runtime_assets import prepare_runtime, prepare_cuda_runtime

if __name__ == '__main__':
    print(prepare_runtime())
    print(prepare_cuda_runtime())
