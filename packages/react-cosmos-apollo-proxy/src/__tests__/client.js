import React from 'react';
import { mount } from 'enzyme';
import { InMemoryCache, ID_KEY } from 'apollo-cache-inmemory';
import { HttpLink } from 'apollo-link-http';
import { graphql } from 'react-apollo';
import gql from 'graphql-tag';
import fetchMock from 'fetch-mock';
import until from 'async-until';
import { createApolloProxy } from '..';

const sampleQuery = gql`
  query SampleQuery($authorId: Int!) {
    author(authorId: $authorId) {
      id
      firstName
    }
  }
`;

const SampleComponent = ({ data }) => {
  if (data.loading) {
    return <span>Loading</span>;
  }

  if (data.error && data.error.graphQLErrors) {
    return (
      <span>
        GraphQL Errors Found:{' '}
        {data.error.graphQLErrors.map(error => error.message).join(', ')}
      </span>
    );
  }

  if (data.error) {
    throw new Error(data.error);
  }

  return <span>{data.author.firstName}</span>;
};

const withData = graphql(sampleQuery, {
  options: ({ authorId }) => ({ variables: { authorId } })
});

const sampleFixture = {
  component: withData(SampleComponent),
  props: {
    authorId: 1
  }
};

// used under the hood by HttpLink
global.fetch = fetchMock.fetchMock;

// render the component fixture
const LastProxy = ({ fixture }) => <fixture.component {...fixture.props} />;

// vars populated from scratch before each test
let onFixtureUpdate;
let wrapper;

// utility to get the fixture wrapped component
const getWrappedComponent = () => {
  wrapper.update();

  return wrapper.find(sampleFixture.component.WrappedComponent);
};

// utility to instantiate the proxy and the fixture
const setupTestWrapper = ({ proxyConfig, fixture } = {}) => {
  // create Proxy with default options
  const ApolloProxy = createApolloProxy(proxyConfig);

  onFixtureUpdate = jest.fn();

  wrapper = mount(
    <ApolloProxy
      nextProxy={{
        value: LastProxy,
        next: () => {}
      }}
      fixture={fixture || sampleFixture}
      onComponentRef={() => {}}
      onFixtureUpdate={onFixtureUpdate}
    />
  );
};

describe('proxy not configured', () => {
  // don't show the error in the console (cosmetic purpose)
  const originalConsoleError = console.error;
  beforeAll(() => {
    console.error = () => {};
  });

  it('throws an error', () => {
    expect(() => setupTestWrapper()).toThrow();
  });

  afterAll(() => {
    console.error = originalConsoleError;
  });
});

describe('proxy configured with a client', () => {
  const resolveWith = {
    author: {
      __typename: 'Author',
      id: 1,
      firstName: 'Jane Dough',
      [ID_KEY]: 'Author:1'
    }
  };
  let clientOptions;

  beforeAll(() => {
    fetchMock.post('https://xyz', { data: resolveWith });
  });

  afterEach(() => {
    fetchMock.reset();
  });

  beforeEach(() => {
    clientOptions = {
      cache: new InMemoryCache(),
      link: new HttpLink({ uri: 'https://xyz' })
    };

    setupTestWrapper({ proxyConfig: { clientOptions } });
  });

  it('uses the clientOptions passed in the config', () => {
    expect(wrapper.instance().client.cache).toBe(clientOptions.cache);
  });

  it('connects to the Apollo DevTools', () => {
    expect(parent.__APOLLO_CLIENT__).toBe(wrapper.instance().client);
  });
});

describe('proxy configured with an endpoint', () => {
  const resolveWith = {
    author: {
      __typename: 'Author',
      id: 1,
      firstName: 'Jane Dough',
      [ID_KEY]: 'Author:1'
    }
  };

  beforeAll(() => {
    fetchMock.post('https://xyz', { data: resolveWith });
  });

  afterEach(() => {
    fetchMock.reset();
  });

  it('uses a default http link if the fixture has not mocked data', async () => {
    setupTestWrapper({
      proxyConfig: {
        endpoint: 'https://xyz'
      }
    });

    expect(fetchMock.called('https://xyz', 'POST')).toBe(true);

    // wait for the fake network request to complete
    await until(() => !getWrappedComponent().props().data.loading);

    expect(getWrappedComponent().props().data.author).toMatchObject(
      resolveWith.author
    );
  });

  it('uses a fixture link if the fixture has mocked data', async () => {
    setupTestWrapper({
      proxyConfig: {
        endpoint: 'https://xyz'
      },
      fixture: {
        ...sampleFixture,
        apollo: {
          resolveWith
        }
      }
    });

    // no network requests issued
    expect(fetchMock.called('https://xyz', 'POST')).toBe(false);

    // can be async even if data is mocked
    await until(() => getWrappedComponent().props().data.loading === false);

    expect(getWrappedComponent().props().data.author).toMatchObject(
      resolveWith.author
    );
  });

  it('allows resolveWith to have a root data key', async () => {
    setupTestWrapper({
      proxyConfig: {
        endpoint: 'https://xyz'
      },
      fixture: {
        ...sampleFixture,
        apollo: {
          resolveWith: { data: resolveWith }
        }
      }
    });

    // can be async even if data is mocked
    await until(() => getWrappedComponent().props().data.loading === false);

    expect(getWrappedComponent().props().data.author).toMatchObject(
      resolveWith.author
    );
  });

  it('allows resolveWith to have an errors object', async () => {
    const resolveWith = {
      errors: [
        {
          path: ['author'],
          message: 'Author id 1 not found',
          locations: [{ line: 1, column: 0 }]
        }
      ],
      data: {
        author: null
      }
    };

    setupTestWrapper({
      proxyConfig: {
        endpoint: 'https://xyz'
      },
      fixture: {
        ...sampleFixture,
        apollo: {
          resolveWith
        }
      }
    });

    // can be async even if data is mocked
    await until(() => getWrappedComponent().props().data.loading === false);

    expect(
      getWrappedComponent().props().data.error.graphQLErrors
    ).toMatchObject(resolveWith.errors);
  });

  it('allows resolveWith to return a promise', async () => {
    setupTestWrapper({
      proxyConfig: {
        endpoint: 'https://xyz'
      },
      fixture: {
        ...sampleFixture,
        apollo: {
          resolveWith: () => Promise.resolve(resolveWith)
        }
      }
    });

    // can be async even if data is mocked
    await until(() => getWrappedComponent().props().data.loading === false);

    expect(getWrappedComponent().props().data.author).toMatchObject(
      resolveWith.author
    );
  });

  it('allows resolveWith to reject a promise', async () => {
    const resolveWith = {
      errors: [
        {
          path: ['author'],
          message: 'Author id 1 not found',
          locations: [{ line: 1, column: 0 }]
        }
      ],
      data: {
        author: null
      }
    };

    setupTestWrapper({
      proxyConfig: {
        endpoint: 'https://xyz'
      },
      fixture: {
        ...sampleFixture,
        apollo: {
          resolveWith: () => Promise.reject(resolveWith.errors)
        }
      }
    });

    // can be async even if data is mocked
    await until(() => getWrappedComponent().props().data.loading === false);

    expect(
      getWrappedComponent().props().data.error.graphQLErrors
    ).toMatchObject(resolveWith.errors);
  });

  it('allows simulating latency', async () => {
    jest.useFakeTimers();

    setupTestWrapper({
      proxyConfig: {
        endpoint: 'https://xyz'
      },
      fixture: {
        ...sampleFixture,
        apollo: {
          resolveWith,
          latency: 3
        }
      }
    });

    expect(getWrappedComponent().props().data.loading).toBe(true);

    jest.advanceTimersByTime(3000);

    expect(getWrappedComponent().props().data.loading).toBe(false);

    expect(getWrappedComponent().props().data.author).toMatchObject(
      resolveWith.author
    );
  });

  it('allows simulating endless loading', async () => {
    setupTestWrapper({
      proxyConfig: {
        endpoint: 'https://xyz'
      },
      fixture: {
        ...sampleFixture,
        apollo: {
          resolveWith,
          latency: -1
        }
      }
    });

    const failMsg =
      'You shall never resolve and be condemned to endless loading state.';

    expect(
      until(() => getWrappedComponent().props().data.loading === false, {
        failMsg
      })
    ).rejects.toMatch(failMsg);
  });
});
